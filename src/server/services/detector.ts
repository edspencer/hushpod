import { generateObject, generateText } from 'ai'
import {
  DetectionResultSchema,
  type DetectedSegment,
  type Transcript,
  type AdLabelValue,
} from '../../shared/schemas.js'
import { getModel } from '../lib/llm.js'
import { logger } from '../lib/logger.js'
import type { AppSettings } from '../../shared/schemas.js'
import type { Ad } from '../db/schema.js'

const log = logger('detector')

// Long episodes can exceed a local model's context. Window the transcript and
// merge detections. Ids stay global so mapping back to time is unambiguous.
const WINDOW_SEGMENTS = 500
const WINDOW_OVERLAP = 30

export interface DetectedAd {
  startTime: number
  endTime: number
  label: AdLabelValue
  company: string | null
  adText: string
  reason: string
}

const SYSTEM_PROMPT = `You are an expert at identifying advertisements and promotional content in podcast transcripts.

You will receive a podcast transcript as a numbered list of segments, one per line, in the form:
[<id>] <text>

Identify every span that is an advertisement, sponsor read, cross-promotion, intro, or outro. For each, return the id of the FIRST and LAST segment of the span (inclusive). Use these labels:
- "ad": paid advertisement / sponsor read for a third-party product or service
- "promo": cross-promotion for another show, the host's own products, Patreon, merch, newsletter
- "intro": show intro / cold open boilerplate before content begins
- "outro": end-of-show credits, sign-off, "see you next week"

Rules:
- Only flag clearly promotional or boilerplate content. When in doubt, do NOT flag editorial content.
- Refer to segments ONLY by their [id]. Do not invent timestamps.
- A single ad break may contain multiple distinct ads — return them as separate spans.
- Set "company" to the advertiser/product name if identifiable, otherwise null.
- Keep "reason" to one short sentence.`

function renderTranscript(segments: Transcript['segments']): string {
  return segments.map((s) => `[${s.id}] ${s.text}`).join('\n')
}

function renderPreviousAds(previousAds: Ad[]): string {
  if (previousAds.length === 0) return ''
  const lines = previousAds.map(
    (a) => `- ${a.label}${a.company ? ` (${a.company})` : ''}: ${(a.adText ?? '').slice(0, 160)}`,
  )
  return `\nFor context, the PREVIOUS episode of this show contained these ads/promos. Expect similar advertisers, slots, and copy (but verify against this episode):\n${lines.join('\n')}\n`
}

function buildUserPrompt(segments: Transcript['segments'], previousAds: Ad[]): string {
  return `${renderPreviousAds(previousAds)}\nTranscript:\n${renderTranscript(segments)}`
}

/** Extract the first balanced JSON object from a string (repair path). */
function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  if (start === -1) throw new Error('no JSON object found in model output')
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return JSON.parse(text.slice(start, i + 1))
    }
  }
  throw new Error('unbalanced JSON in model output')
}

/** Run detection on one window of segments, with a generateText repair fallback. */
async function detectWindow(
  settings: AppSettings,
  segments: Transcript['segments'],
  previousAds: Ad[],
): Promise<DetectedSegment[]> {
  const model = getModel(settings)
  const prompt = buildUserPrompt(segments, previousAds)

  try {
    const { object } = await generateObject({
      model,
      schema: DetectionResultSchema,
      system: SYSTEM_PROMPT,
      prompt,
    })
    return object.segments
  } catch (err) {
    log.warn(`generateObject failed, trying repair fallback: ${(err as Error).message}`)
    const { text } = await generateText({
      model,
      system: `${SYSTEM_PROMPT}\n\nRespond with ONLY a JSON object: {"segments":[{"startSegmentId":N,"endSegmentId":N,"label":"ad|promo|intro|outro","company":string|null,"reason":string}]}. No prose, no markdown.`,
      prompt,
    })
    const parsed = DetectionResultSchema.parse(extractJson(text))
    return parsed.segments
  }
}

/** Merge detections whose id-ranges overlap, keeping the widest span. */
function mergeOverlaps(detected: DetectedSegment[]): DetectedSegment[] {
  const sorted = [...detected].sort((a, b) => a.startSegmentId - b.startSegmentId)
  const merged: DetectedSegment[] = []
  for (const d of sorted) {
    const last = merged[merged.length - 1]
    if (last && d.startSegmentId <= last.endSegmentId + 1) {
      last.endSegmentId = Math.max(last.endSegmentId, d.endSegmentId)
      last.company = last.company ?? d.company
    } else {
      merged.push({ ...d })
    }
  }
  return merged
}

/**
 * Detect ads in a transcript. Windows long transcripts, merges results, and
 * maps segment-id ranges back to exact times from the whisper segments.
 */
export async function detectAds(
  transcript: Transcript,
  settings: AppSettings,
  previousAds: Ad[] = [],
): Promise<DetectedAd[]> {
  const segs = transcript.segments
  if (segs.length === 0) return []

  const byId = new Map(segs.map((s) => [s.id, s]))
  const raw: DetectedSegment[] = []

  for (let i = 0; i < segs.length; i += WINDOW_SEGMENTS - WINDOW_OVERLAP) {
    const window = segs.slice(i, i + WINDOW_SEGMENTS)
    if (window.length === 0) break
    log.info(`detecting window ${i}-${i + window.length} of ${segs.length} segments`)
    const found = await detectWindow(settings, window, previousAds)
    raw.push(...found)
    if (i + WINDOW_SEGMENTS >= segs.length) break
  }

  const merged = mergeOverlaps(raw)
  const result: DetectedAd[] = []
  for (const d of merged) {
    const lo = Math.min(d.startSegmentId, d.endSegmentId)
    const hi = Math.max(d.startSegmentId, d.endSegmentId)
    const startSeg = byId.get(lo)
    const endSeg = byId.get(hi)
    if (!startSeg || !endSeg) {
      log.warn(`dropping detection with out-of-range ids ${lo}-${hi}`)
      continue
    }
    const spanText = segs
      .filter((s) => s.id >= lo && s.id <= hi)
      .map((s) => s.text)
      .join(' ')
    result.push({
      startTime: startSeg.start,
      endTime: endSeg.end,
      label: d.label,
      company: d.company,
      adText: spanText,
      reason: d.reason,
    })
  }

  log.info(`detected ${result.length} ad/promo segment(s)`)
  return result
}
