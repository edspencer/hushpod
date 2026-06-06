import { spawn } from 'node:child_process'
import { logger } from './logger.js'

const log = logger('ffmpeg')

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe'

export interface TimeRange {
  start: number
  end: number
}

/** Run ffmpeg/ffprobe, rejecting on non-zero exit. Returns collected stderr. */
function run(bin: string, args: string[]): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stderr })
      else reject(new Error(`${bin} exited ${code}: ${stderr.slice(-2000)}`))
    })
  })
}

/** Probe duration in seconds. */
export async function probeDuration(input: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      input,
    ]
    const child = spawn(FFPROBE, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d.toString()))
    child.stderr.on('data', (d) => (err += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      const v = Number.parseFloat(out.trim())
      if (code === 0 && Number.isFinite(v)) resolve(v)
      else reject(new Error(`ffprobe failed (${code}): ${err.slice(-500)}`))
    })
  })
}

/**
 * Extract a window of mono f32 PCM samples at the given sample rate. Used by
 * transition-sound detection to compute RMS energy near ad boundaries.
 */
export function extractPcm(
  input: string,
  startSec: number,
  durationSec: number,
  sampleRate = 16000,
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'error',
      '-ss',
      Math.max(0, startSec).toString(),
      '-t',
      durationSec.toString(),
      '-i',
      input,
      '-f',
      'f32le',
      '-acodec',
      'pcm_f32le',
      '-ac',
      '1',
      '-ar',
      sampleRate.toString(),
      'pipe:1',
    ]
    const child = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let err = ''
    child.stdout.on('data', (d: Buffer) => chunks.push(d))
    child.stderr.on('data', (d) => (err += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg pcm extract failed (${code}): ${err.slice(-500)}`))
      const buf = Buffer.concat(chunks)
      // Float32Array view over the byte buffer (aligned copy to be safe).
      const f32 = new Float32Array(buf.byteLength / 4)
      for (let i = 0; i < f32.length; i++) f32[i] = buf.readFloatLE(i * 4)
      resolve(f32)
    })
  })
}

/**
 * Cut `input` down to the given keep ranges and write `output`, re-encoding to
 * MP3. Re-encoding (not stream-copy) is required because cuts fall at arbitrary
 * points, not frame boundaries. Metadata is carried over from the source.
 *
 * crossfadeMs > 0 applies an acrossfade between consecutive kept ranges to
 * avoid audible pops; 0 = hard cut (default).
 */
export async function cutToRanges(
  input: string,
  output: string,
  keep: TimeRange[],
  crossfadeMs = 0,
): Promise<void> {
  if (keep.length === 0) throw new Error('cutToRanges: no keep ranges (would produce empty audio)')

  const labels: string[] = []
  const parts: string[] = []
  keep.forEach((r, i) => {
    const lbl = `a${i}`
    parts.push(`[0:a]atrim=start=${r.start.toFixed(3)}:end=${r.end.toFixed(3)},asetpts=PTS-STARTPTS[${lbl}]`)
    labels.push(`[${lbl}]`)
  })

  let finalLabel: string
  if (crossfadeMs > 0 && keep.length > 1) {
    // Chain acrossfade pairwise: ((a0 x a1) x a2) ...
    const cf = (crossfadeMs / 1000).toFixed(3)
    let prev = labels[0]!
    for (let i = 1; i < labels.length; i++) {
      const out = i === labels.length - 1 ? 'mix' : `mix${i}`
      parts.push(`${prev}${labels[i]}acrossfade=d=${cf}:c1=tri:c2=tri[${out}]`)
      prev = `[${out}]`
    }
    finalLabel = '[mix]'
  } else {
    parts.push(`${labels.join('')}concat=n=${labels.length}:v=0:a=1[out]`)
    finalLabel = '[out]'
  }

  const args = [
    '-v',
    'error',
    '-i',
    input,
    '-filter_complex',
    parts.join(';'),
    '-map',
    finalLabel,
    '-map_metadata',
    '0',
    '-c:a',
    'libmp3lame',
    '-q:a',
    '2',
    '-id3v2_version',
    '3',
    '-y',
    output,
  ]
  log.info(`cutting ${keep.length} segment(s) -> ${output}`)
  await run(FFMPEG, args)
}

/** Convert any input audio to a 16kHz mono WAV (whisper-friendly). */
export async function toWav16k(input: string, output: string): Promise<void> {
  await run(FFMPEG, ['-v', 'error', '-i', input, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', output])
}
