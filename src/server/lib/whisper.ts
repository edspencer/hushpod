import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { nodewhisper } from 'nodejs-whisper'
import { logger } from './logger.js'
import { probeDuration, extractSliceWav } from './ffmpeg.js'
import type { AppSettings, Transcript, TranscriptSegment } from '../../shared/schemas.js'

const log = logger('whisper')

// Chunk long episodes so local whisper.cpp doesn't OOM and remote uploads stay
// reasonable (a prior-art lesson). Chunks overlap so a word at a boundary isn't
// lost; segments are assigned to exactly one chunk by their start time.
const CHUNK_SEC = 20 * 60
const OVERLAP_SEC = 20
const STEP_SEC = CHUNK_SEC - OVERLAP_SEC

interface RawSegment {
  start: number
  end: number
  text: string
}

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

/** Reindex to sequential ids and drop obvious hallucinations. */
function finalize(raw: RawSegment[], language?: string): Transcript {
  const sorted = [...raw].sort((a, b) => a.start - b.start)
  const segments: TranscriptSegment[] = []
  let id = 0
  for (const s of sorted) {
    const text = s.text.trim()
    if (isHallucination(text)) continue
    segments.push({ id: id++, start: s.start, end: s.end, text })
  }
  const durationSec = segments.length > 0 ? segments[segments.length - 1]!.end : 0
  return { language, durationSec, segments }
}

/**
 * Transcribe an episode. Always operates on 16kHz mono WAV slices; short
 * episodes are a single chunk. Timestamps are offset to absolute episode time
 * and de-duplicated across overlapping chunk seams.
 */
export async function transcribe(
  audioPathInput: string,
  settings: AppSettings,
): Promise<Transcript> {
  // Absolute path: nodejs-whisper mutates process.cwd(), which would otherwise
  // break any relative path on later iterations.
  const audioPath = resolve(audioPathInput)
  const duration = await probeDuration(audioPath)
  const raw: RawSegment[] = []
  let language: string | undefined

  let chunkIndex = 0
  for (let chunkStart = 0; chunkStart < duration; chunkStart += STEP_SEC) {
    const chunkDur = Math.min(CHUNK_SEC, duration - chunkStart)
    if (chunkDur <= 0.5) break
    const isLast = chunkStart + CHUNK_SEC >= duration

    const slice = join(tmpdir(), `hushpod-${process.pid}-${chunkStart}.wav`)
    await extractSliceWav(audioPath, chunkStart, chunkDur, slice)
    try {
      log.info(
        `transcribing chunk ${chunkIndex} [${chunkStart}s +${chunkDur.toFixed(0)}s] (${settings.whisperMode})`,
      )
      const { segments, language: lang } = await transcribeSlice(slice, settings)
      if (!language) language = lang
      for (const seg of segments) {
        // A segment in the trailing overlap belongs to the next chunk; skip it
        // here (unless this is the last chunk).
        if (!isLast && seg.start >= STEP_SEC) continue
        raw.push({ start: seg.start + chunkStart, end: seg.end + chunkStart, text: seg.text })
      }
    } finally {
      await unlink(slice).catch(() => {})
    }
    chunkIndex++
    if (isLast) break
  }

  if (raw.length === 0) throw new Error('transcription produced no segments')
  return finalize(raw, language)
}

/** Transcribe one already-16kHz-mono WAV slice (local or remote). */
async function transcribeSlice(
  wavPath: string,
  settings: AppSettings,
): Promise<{ segments: RawSegment[]; language?: string }> {
  if (settings.whisperMode === 'remote') {
    if (!settings.whisperEndpoint)
      throw new Error('whisperMode=remote but whisperEndpoint is empty')
    return transcribeRemote(wavPath, settings)
  }
  return transcribeLocal(wavPath, settings)
}

/** Remote transcription via an OpenAI-compatible /audio/transcriptions endpoint.
 * `whisperEndpoint` is the base URL up to and including /v1. */
async function transcribeRemote(
  wavPath: string,
  settings: AppSettings,
): Promise<{ segments: RawSegment[]; language?: string }> {
  const base = settings.whisperEndpoint.replace(/\/$/, '')
  const url = `${base}/audio/transcriptions`
  const buf = await readFile(wavPath)
  const form = new FormData()
  form.append('file', new Blob([buf], { type: 'audio/wav' }), 'audio.wav')
  form.append('model', settings.whisperModel)
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'segment')

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
  }
  if (!json.segments || json.segments.length === 0) {
    throw new Error('remote transcription returned no timestamped segments')
  }
  return { segments: json.segments, language: json.language }
}

/** Local transcription via nodejs-whisper (whisper.cpp). Reads the emitted
 * <wav>.json (offsets are in milliseconds). */
async function transcribeLocal(
  wavPath: string,
  settings: AppSettings,
): Promise<{ segments: RawSegment[]; language?: string }> {
  // nodejs-whisper does process.chdir() into the whisper.cpp dir and does not
  // restore it — capture and restore the cwd ourselves.
  const cwd = process.cwd()
  try {
    await nodewhisper(wavPath, {
      modelName: settings.whisperModel,
      autoDownloadModelName: settings.whisperModel,
      removeWavFileAfterTranscription: false,
      whisperOptions: { outputInJson: true, language: 'en' },
      logger: { log: () => {}, debug: () => {}, error: (...a) => log.error(String(a[0])) },
    })
  } finally {
    process.chdir(cwd)
  }
  try {
    const parsed = JSON.parse(await readFile(`${wavPath}.json`, 'utf8')) as {
      transcription?: Array<{ offsets?: { from: number; to: number }; text: string }>
    }
    const segments = (parsed.transcription ?? []).map((t) => ({
      start: (t.offsets?.from ?? 0) / 1000,
      end: (t.offsets?.to ?? 0) / 1000,
      text: t.text,
    }))
    return { segments }
  } finally {
    await unlink(`${wavPath}.json`).catch(() => {})
  }
}
