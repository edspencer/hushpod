import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodewhisper } from 'nodejs-whisper'
import { logger } from './logger.js'
import { toWav16k } from './ffmpeg.js'
import type { AppSettings } from '../../shared/schemas.js'
import type { Transcript, TranscriptSegment } from '../../shared/schemas.js'

const log = logger('whisper')

/**
 * Whisper hallucinates fixed phrases on silence/music (a well-documented failure
 * mode — see docs/prior-art-lessons.md). Drop segments that are *only* one of
 * these common artifacts.
 */
const HALLUCINATION_PATTERNS = [
  /^thanks? for watching\.?$/i,
  /^thank you\.?$/i,
  /^you\.?$/i,
  /amara\.org/i,
  /^subscribe.*$/i,
  /^\[.*music.*\]$/i,
  /^\(.*music.*\)$/i,
]

function isHallucination(text: string): boolean {
  const t = text.trim()
  if (t.length === 0) return true
  return HALLUCINATION_PATTERNS.some((re) => re.test(t))
}

/** Reindex segments to sequential ids and drop obvious hallucinations. */
function finalize(raw: Array<{ start: number; end: number; text: string }>, language?: string): Transcript {
  const segments: TranscriptSegment[] = []
  let id = 0
  for (const s of raw) {
    const text = s.text.trim()
    if (isHallucination(text)) continue
    segments.push({ id: id++, start: s.start, end: s.end, text })
  }
  const durationSec = segments.length > 0 ? segments[segments.length - 1]!.end : 0
  return { language, durationSec, segments }
}

/** Dispatch to local or remote transcription based on settings. */
export async function transcribe(audioPath: string, settings: AppSettings): Promise<Transcript> {
  if (settings.whisperMode === 'remote') {
    if (!settings.whisperEndpoint) throw new Error('whisperMode=remote but whisperEndpoint is empty')
    return transcribeRemote(audioPath, settings)
  }
  return transcribeLocal(audioPath, settings)
}

/**
 * Remote transcription via an OpenAI-compatible /audio/transcriptions endpoint.
 * `whisperEndpoint` is the base URL up to and including /v1.
 */
async function transcribeRemote(audioPath: string, settings: AppSettings): Promise<Transcript> {
  const base = settings.whisperEndpoint.replace(/\/$/, '')
  const url = `${base}/audio/transcriptions`
  const buf = await readFile(audioPath)
  const form = new FormData()
  form.append('file', new Blob([buf]), audioPath.split('/').pop() ?? 'audio.mp3')
  form.append('model', settings.whisperModel)
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'segment')

  log.info(`remote transcribe -> ${url} (model=${settings.whisperModel})`)
  const headers: Record<string, string> = {}
  if (settings.whisperApiKey) headers.Authorization = `Bearer ${settings.whisperApiKey}`

  const res = await fetch(url, { method: 'POST', body: form, headers })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`remote transcription failed (${res.status}): ${body.slice(0, 500)}`)
  }
  const json = (await res.json()) as {
    language?: string
    segments?: Array<{ start: number; end: number; text: string }>
    text?: string
  }
  if (!json.segments || json.segments.length === 0) {
    // Some servers return only `text` without segments; we cannot place ads
    // without timestamps, so treat as a hard failure.
    throw new Error('remote transcription returned no timestamped segments')
  }
  return finalize(json.segments, json.language)
}

/**
 * Local transcription via nodejs-whisper (whisper.cpp). We convert to 16kHz
 * mono WAV first, run with JSON output, then parse the emitted <wav>.json
 * (offsets are in milliseconds).
 */
async function transcribeLocal(audioPath: string, settings: AppSettings): Promise<Transcript> {
  const wavPath = join(tmpdir(), `hushpod-${process.pid}-${Date.now()}.wav`)
  await toWav16k(audioPath, wavPath)
  try {
    log.info(`local transcribe (model=${settings.whisperModel})`)
    await nodewhisper(wavPath, {
      modelName: settings.whisperModel,
      autoDownloadModelName: settings.whisperModel,
      removeWavFileAfterTranscription: false,
      whisperOptions: { outputInJson: true, language: 'en' },
      logger: { log: () => {}, debug: () => {}, error: (...a) => log.error(String(a[0])) },
    })
    const jsonRaw = await readFile(`${wavPath}.json`, 'utf8')
    const parsed = JSON.parse(jsonRaw) as {
      transcription?: Array<{ offsets?: { from: number; to: number }; text: string }>
    }
    const segments = (parsed.transcription ?? []).map((t) => ({
      start: (t.offsets?.from ?? 0) / 1000,
      end: (t.offsets?.to ?? 0) / 1000,
      text: t.text,
    }))
    if (segments.length === 0) throw new Error('local transcription produced no segments')
    return finalize(segments)
  } finally {
    await unlink(wavPath).catch(() => {})
    await unlink(`${wavPath}.json`).catch(() => {})
  }
}
