import { extractPcm } from '../lib/ffmpeg.js'
import { logger } from '../lib/logger.js'
import type { TimeRange } from '../lib/ffmpeg.js'
import type { AppSettings } from '../../shared/schemas.js'

const log = logger('transition')

const SR = 16000
const FRAME_MS = 200
const HOP_MS = 100

interface Frame {
  t: number // seconds (relative to window start)
  rms: number
}

/** Compute RMS over a sliding window across mono f32 PCM. */
function rmsFrames(pcm: Float32Array): Frame[] {
  const frameLen = Math.floor((FRAME_MS / 1000) * SR)
  const hop = Math.floor((HOP_MS / 1000) * SR)
  const frames: Frame[] = []
  for (let start = 0; start + frameLen <= pcm.length; start += hop) {
    let sumSq = 0
    for (let i = start; i < start + frameLen; i++) sumSq += pcm[i]! * pcm[i]!
    frames.push({ t: start / SR, rms: Math.sqrt(sumSq / frameLen) })
  }
  return frames
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length
}

/**
 * Search a window of audio for a high-energy spike (chime/jingle) relative to
 * the surrounding speech. Returns the [spikeStart, spikeEnd] in seconds
 * relative to the window start, or null if none found.
 */
function findSpike(pcm: Float32Array, threshold: number): { start: number; end: number } | null {
  const frames = rmsFrames(pcm)
  if (frames.length < 4) return null
  const baseline = mean(frames.map((f) => f.rms))
  if (baseline <= 0) return null
  const noiseFloor = baseline * 0.5

  let spikeStart = -1
  let spikeEnd = -1
  for (const f of frames) {
    if (f.rms >= threshold * baseline) {
      if (spikeStart < 0) spikeStart = f.t
      spikeEnd = f.t + FRAME_MS / 1000
    }
  }
  if (spikeStart < 0) return null

  // Snap the spike edges outward to the nearest near-silence for a clean cut.
  let s = spikeStart
  for (const f of frames) {
    if (f.t < spikeStart && f.rms < noiseFloor) s = f.t
  }
  let e = spikeEnd
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i]!
    if (f.t > spikeEnd && f.rms < noiseFloor) e = f.t
  }
  return { start: s, end: e }
}

/**
 * For each detected ad, look just before its start and just after its end for a
 * transition chime, and extend the cut boundary to swallow it. Operates on cut
 * ranges (seconds) and returns adjusted ranges. Fails safe: on any error the
 * original range is kept.
 */
export async function extendForTransitions(
  originalPath: string,
  cuts: TimeRange[],
  duration: number,
  settings: AppSettings,
): Promise<TimeRange[]> {
  if (!settings.enableTransitionDetection) return cuts
  const W = settings.transitionWindowSeconds
  const threshold = settings.transitionEnergyThreshold

  const adjusted: TimeRange[] = []
  for (const cut of cuts) {
    let { start, end } = cut
    try {
      // Window before the ad start.
      const beforeStart = Math.max(0, start - W)
      if (start - beforeStart > 0.3) {
        const pcm = await extractPcm(originalPath, beforeStart, start - beforeStart, SR)
        const spike = findSpike(pcm, threshold)
        if (spike) {
          const spikeAbs = beforeStart + spike.start
          if (spikeAbs < start) {
            log.info(
              `extending ad start ${start.toFixed(1)}s -> ${spikeAbs.toFixed(1)}s (pre-chime)`,
            )
            start = spikeAbs
          }
        }
      }
      // Window after the ad end.
      const afterLen = Math.min(W, duration - end)
      if (afterLen > 0.3) {
        const pcm = await extractPcm(originalPath, end, afterLen, SR)
        const spike = findSpike(pcm, threshold)
        if (spike) {
          const spikeAbsEnd = end + spike.end
          if (spikeAbsEnd > end) {
            log.info(
              `extending ad end ${end.toFixed(1)}s -> ${spikeAbsEnd.toFixed(1)}s (post-chime)`,
            )
            end = Math.min(duration, spikeAbsEnd)
          }
        }
      }
    } catch (err) {
      log.warn(
        `transition scan failed for [${start}-${end}], keeping original: ${(err as Error).message}`,
      )
    }
    adjusted.push({ start, end })
  }
  return adjusted
}
