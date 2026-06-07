import type { Transcript } from '../../shared/schemas.js'

/**
 * Cross-episode recurrence detection.
 *
 * Formulaic shows (e.g. "Nothing Much Happens", NPR's billboards/credits) repeat
 * the same spoken boilerplate near-verbatim every episode. That repetition is a
 * far stronger, more reliable signal than asking an LLM "is this structural?"
 * per episode. We find spans of the CURRENT episode whose wording recurs across
 * recent PRIOR episodes of the same show, and hand them to the detector as
 * high-confidence "fluff" candidates.
 *
 * Method: shingle each transcript into overlapping K-word windows (normalized,
 * hashed). A window in the current episode is "recurring" if the same shingle
 * appears in at least `minEpisodes` prior episodes. We then mark every token
 * covered by a recurring shingle, roll that up to whole transcript segments, and
 * merge adjacent recurring segments into spans (bridging tiny gaps). Short or
 * one-off matches are dropped so common phrases don't get flagged.
 */

export interface RecurringSpan {
  startSegmentId: number
  endSegmentId: number
  text: string
}

export interface RecurrenceOptions {
  /** Shingle length in words. Longer = stricter (fewer coincidental matches). */
  shingleSize: number
  /** A shingle counts as recurring if it appears in at least this many priors. */
  minEpisodes: number
  /** A segment is "recurring" if at least this fraction of its words are. */
  segmentCoverage: number
  /** Bridge a gap of up to this many non-recurring segments inside a span. */
  maxGapSegments: number
  /** Drop spans shorter than this (seconds), to avoid one-liner noise. */
  minSpanSeconds: number
}

export const DEFAULT_RECURRENCE: RecurrenceOptions = {
  shingleSize: 8,
  minEpisodes: 2,
  segmentCoverage: 0.5,
  maxGapSegments: 1,
  minSpanSeconds: 5,
}

interface Token {
  word: string
  segId: number
}

/** Lowercase, drop punctuation, collapse whitespace → words tagged by segment. */
function tokenize(segments: Transcript['segments']): Token[] {
  const tokens: Token[] = []
  for (const s of segments) {
    const words = s.text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
    for (const w of words) if (w) tokens.push({ word: w, segId: s.id })
  }
  return tokens
}

/** The set of distinct K-word shingles present in a token list. */
function shingleSet(tokens: Token[], k: number): Set<string> {
  const set = new Set<string>()
  for (let i = 0; i + k <= tokens.length; i++) {
    set.add(
      tokens
        .slice(i, i + k)
        .map((t) => t.word)
        .join(' '),
    )
  }
  return set
}

/**
 * Find spans of `current` whose wording recurs across `priors`. Returns spans as
 * inclusive transcript segment-id ranges (the unit the detector/LLM works in).
 */
export function findRecurringSpans(
  current: Transcript,
  priors: Transcript[],
  options: Partial<RecurrenceOptions> = {},
): RecurringSpan[] {
  const opts = { ...DEFAULT_RECURRENCE, ...options }
  const segs = current.segments
  if (segs.length === 0 || priors.length === 0) return []

  const k = opts.shingleSize
  const minEpisodes = Math.min(opts.minEpisodes, priors.length)

  // Per-prior shingle sets (de-duped within an episode so repetition inside one
  // episode can't satisfy the cross-episode threshold).
  const priorShingles = priors.map((p) => shingleSet(tokenize(p.segments), k))

  const curTokens = tokenize(segs)
  if (curTokens.length < k) return []

  // Mark every current-episode token covered by a recurring shingle.
  const recurringToken = new Array<boolean>(curTokens.length).fill(false)
  for (let i = 0; i + k <= curTokens.length; i++) {
    const shingle = curTokens
      .slice(i, i + k)
      .map((t) => t.word)
      .join(' ')
    let hits = 0
    for (const ps of priorShingles) if (ps.has(shingle)) hits++
    if (hits >= minEpisodes) {
      for (let j = i; j < i + k; j++) recurringToken[j] = true
    }
  }

  // Roll token marks up to whole segments.
  const totalBySeg = new Map<number, number>()
  const recurringBySeg = new Map<number, number>()
  curTokens.forEach((t, idx) => {
    totalBySeg.set(t.segId, (totalBySeg.get(t.segId) ?? 0) + 1)
    if (recurringToken[idx]) recurringBySeg.set(t.segId, (recurringBySeg.get(t.segId) ?? 0) + 1)
  })

  const segById = new Map(segs.map((s) => [s.id, s]))
  const orderedIds = segs.map((s) => s.id)
  const isRecurring = (segId: number) => {
    const total = totalBySeg.get(segId) ?? 0
    if (total === 0) return false
    return (recurringBySeg.get(segId) ?? 0) / total >= opts.segmentCoverage
  }

  // Group consecutive recurring segments into spans, bridging small gaps.
  const spans: RecurringSpan[] = []
  let runStart = -1
  let runEnd = -1
  let gap = 0
  const flush = () => {
    if (runStart < 0) return
    const startSeg = segById.get(orderedIds[runStart]!)!
    const endSeg = segById.get(orderedIds[runEnd]!)!
    if (endSeg.end - startSeg.start >= opts.minSpanSeconds) {
      const text = segs
        .slice(runStart, runEnd + 1)
        .map((s) => s.text)
        .join(' ')
      spans.push({ startSegmentId: startSeg.id, endSegmentId: endSeg.id, text })
    }
    runStart = runEnd = -1
    gap = 0
  }

  for (let i = 0; i < orderedIds.length; i++) {
    if (isRecurring(orderedIds[i]!)) {
      if (runStart < 0) runStart = i
      runEnd = i
      gap = 0
    } else if (runStart >= 0) {
      gap++
      if (gap > opts.maxGapSegments) flush()
    }
  }
  flush()

  return spans
}
