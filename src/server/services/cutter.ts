import { stat } from 'node:fs/promises'
import { cutToRanges, type TimeRange } from '../lib/ffmpeg.js'
import { logger } from '../lib/logger.js'
import type { AppSettings } from '../../shared/schemas.js'

const log = logger('cutter')

// Ads separated by a tiny gap are really one break; merge them so we don't
// leave a 0.5s sliver of content between two cuts (a prior-art lesson).
const MERGE_GAP_SEC = 1.0

/** Merge overlapping/near-adjacent cut ranges and clamp to [0, duration]. */
export function normalizeCuts(cuts: TimeRange[], duration: number): TimeRange[] {
  const clamped = cuts
    .map((c) => ({
      start: Math.max(0, Math.min(c.start, c.end)),
      end: Math.min(duration, Math.max(c.start, c.end)),
    }))
    .filter((c) => c.end - c.start > 0.05)
    .sort((a, b) => a.start - b.start)

  const merged: TimeRange[] = []
  for (const c of clamped) {
    const last = merged[merged.length - 1]
    if (last && c.start - last.end <= MERGE_GAP_SEC) {
      last.end = Math.max(last.end, c.end)
    } else {
      merged.push({ ...c })
    }
  }
  return merged
}

/** Compute the kept (non-ad) ranges = complement of cuts within [0, duration]. */
export function computeKeepRanges(duration: number, cuts: TimeRange[]): TimeRange[] {
  const merged = normalizeCuts(cuts, duration)
  const keep: TimeRange[] = []
  let cursor = 0
  for (const c of merged) {
    if (c.start - cursor > 0.05) keep.push({ start: cursor, end: c.start })
    cursor = Math.max(cursor, c.end)
  }
  if (duration - cursor > 0.05) keep.push({ start: cursor, end: duration })
  return keep
}

export interface CutResult {
  path: string
  size: number
  removedSeconds: number
}

/**
 * Produce a clean audio file at `outputPath` with the given ad ranges removed.
 * If there are no cuts, the whole episode is re-encoded as the clean version so
 * the served feed always points at a consistent clean.mp3.
 */
export async function cutEpisode(
  originalPath: string,
  outputPath: string,
  cuts: TimeRange[],
  duration: number,
  settings: AppSettings,
): Promise<CutResult> {
  const keep = computeKeepRanges(duration, cuts)
  if (keep.length === 0)
    throw new Error('cutEpisode: every second was marked as ad — refusing to produce empty audio')

  const keptSeconds = keep.reduce((acc, r) => acc + (r.end - r.start), 0)
  const removedSeconds = Math.max(0, duration - keptSeconds)

  await cutToRanges(originalPath, outputPath, keep, settings.crossfadeMs)
  const { size } = await stat(outputPath)
  log.info(`removed ${removedSeconds.toFixed(1)}s across ${cuts.length} ad(s) -> ${outputPath}`)
  return { path: outputPath, size, removedSeconds }
}
