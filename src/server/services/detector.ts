import { generateObject, generateText } from 'ai'
import { z } from 'zod'
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
  confidence?: 'low' | 'medium' | 'high'
}

// A detected span is "suspect" (sent to the verifier) when it is long enough to
// likely be editorial, or the model itself wasn't confident.
const SUSPECT_MAX_SECONDS = 5 * 60

const SYSTEM_PROMPT = `You are an expert at identifying advertisements and promotional content in podcast transcripts.

You will receive a podcast transcript as a numbered list of segments, one per line, in the form:
[<id>] <text>

Identify every span that is an advertisement, sponsor read, cross-promotion, intro, or outro. For each, return the id of the FIRST and LAST segment of the span (inclusive). Use these labels:
- "ad": a paid advertisement / sponsor read for a third-party product or service
- "promo": an explicit plug to buy/subscribe/follow/support something — another show, Patreon, merch, a newsletter, or the show's own paid tier
- "intro": show intro / cold open boilerplate before content begins
- "outro": end-of-show credits, sign-off, "see you next week", bonus-material hand-off

What an ad or promo ACTUALLY looks like — it contains explicit promotional language:
- a call to action ("go to…", "sign up", "use code…", "check out…", "download…")
- a URL, promo code, or pricing/offer
- a sponsorship frame ("this episode is sponsored by…", "support for this show comes from…")
If a span has NONE of these signals, it is almost certainly editorial — do NOT flag it.

CRITICAL — never flag editorial content:
- Interview answers, host/guest discussion, narration, storytelling, and analysis are NEVER ads or promos, even when they mention a company, product, brand, or the episode's own topic.
- A passage is not a promo just because it resembles the episode description.

Length: ads/promos are usually seconds to ~3 minutes; intros/outros are short. Be increasingly skeptical of long spans — a span over ~5 minutes is almost always editorial. Only flag a long span if it contains sustained, unmistakable ad language, and reflect your doubt in "confidence".

Rules:
- Refer to segments ONLY by their [id]. Do not invent timestamps.
- A single ad break may contain multiple distinct ads — return them as separate spans.
- Set "company" to an advertiser/product name ONLY if it is named in THIS transcript. Never carry an advertiser over from another episode.
- Set "confidence": high only when explicit ad language is present; medium if likely; low if uncertain.
- Keep "reason" to one short sentence, citing the ad signal you found.`

function renderTranscript(segments: Transcript['segments']): string {
  return segments.map((s) => `[${s.id}] ${s.text}`).join('\n')
}

function renderPreviousAds(previousAds: Ad[]): string {
  if (previousAds.length === 0) return ''
  // Structural hint only — counts by label, NOT advertiser names or ad copy.
  // Injecting prior company names primes the model to stamp them onto unrelated
  // editorial content (see docs/prior-art-lessons.md), so we deliberately omit
  // them; the company must be read from THIS episode's transcript.
  const counts = new Map<string, number>()
  for (const a of previousAds) counts.set(a.label, (counts.get(a.label) ?? 0) + 1)
  const summary = [...counts.entries()].map(([label, n]) => `${n} ${label}`).join(', ')
  return `\nContext: the previous episode of this show contained ${summary}, so this show does run ads. Use this only as a hint that ads are likely — identify and label every segment solely from THIS transcript, and do not assume the same advertisers appear.\n`
}

function renderGuidance(guidance?: string | null): string {
  const g = guidance?.trim()
  if (!g) return ''
  return `\nShow-specific guidance from the user — follow this carefully, it describes how THIS show's ads/promos behave:\n${g}\n`
}

function buildUserPrompt(
  segments: Transcript['segments'],
  previousAds: Ad[],
  guidance?: string | null,
): string {
  return `${renderGuidance(guidance)}${renderPreviousAds(previousAds)}\nTranscript:\n${renderTranscript(segments)}`
}

/** Extract the first balanced JSON object from a string (repair path). */
export function extractJson(text: string): unknown {
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
  guidance?: string | null,
): Promise<DetectedSegment[]> {
  const model = getModel(settings)
  const prompt = buildUserPrompt(segments, previousAds, guidance)

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
      system: `${SYSTEM_PROMPT}\n\nRespond with ONLY a JSON object: {"segments":[{"startSegmentId":N,"endSegmentId":N,"label":"ad|promo|intro|outro","company":string|null,"reason":string,"confidence":"low|medium|high"}]}. No prose, no markdown.`,
      prompt,
    })
    const parsed = DetectionResultSchema.parse(extractJson(text))
    return parsed.segments
  }
}

const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 } as const
type Confidence = keyof typeof CONFIDENCE_RANK

/** The more cautious of two confidences (used when merging spans). */
function lowerConfidence(a?: Confidence, b?: Confidence): Confidence | undefined {
  if (!a) return b
  if (!b) return a
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b
}

/** Merge detections whose id-ranges overlap, keeping the widest span. */
export function mergeOverlaps(detected: DetectedSegment[]): DetectedSegment[] {
  const sorted = [...detected].sort((a, b) => a.startSegmentId - b.startSegmentId)
  const merged: DetectedSegment[] = []
  for (const d of sorted) {
    const last = merged[merged.length - 1]
    if (last && d.startSegmentId <= last.endSegmentId + 1) {
      last.endSegmentId = Math.max(last.endSegmentId, d.endSegmentId)
      last.company = last.company ?? d.company
      last.confidence = lowerConfidence(last.confidence, d.confidence)
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
  guidance?: string | null,
): Promise<DetectedAd[]> {
  const segs = transcript.segments
  if (segs.length === 0) return []

  const raw: DetectedSegment[] = []

  for (let i = 0; i < segs.length; i += WINDOW_SEGMENTS - WINDOW_OVERLAP) {
    const window = segs.slice(i, i + WINDOW_SEGMENTS)
    if (window.length === 0) break
    log.info(`detecting window ${i}-${i + window.length} of ${segs.length} segments`)
    const found = await detectWindow(settings, window, previousAds, guidance)
    raw.push(...found)
    if (i + WINDOW_SEGMENTS >= segs.length) break
  }

  const mapped = mapDetectionsToAds(raw, segs)
  const verified = await verifyDetections(mapped, settings, guidance)
  log.info(`detected ${mapped.length} segment(s); kept ${verified.length} after verification`)
  return verified
}

const VerifierSchema = z.object({
  isAd: z.boolean().describe('true ONLY if this is genuinely a paid ad or promotional plug'),
  evidence: z.string().nullable().describe('the exact promotional phrase found, or null if none'),
})

const VERIFIER_SYSTEM = `You are a strict ad-detection auditor. You are given ONE span of a podcast transcript that another system flagged as a possible ad/promo. Judge whether it is GENUINELY advertising/promotional, or ordinary editorial/interview/host content.

Be skeptical. A real ad or promo contains explicit promotional language: a call to action ("go to", "sign up", "use code"), a URL or promo code, pricing/an offer, or a sponsorship frame ("sponsored by", "support for this show comes from"). Editorial discussion can mention any brand or topic without being an ad.

If the span lacks explicit ad language, it is editorial — answer isAd=false. Quote the exact promotional phrase as "evidence", or null if there is none.`

/** Re-check "suspect" spans (long, or low-confidence) with an un-primed,
 * adversarially-framed auditor. The verifier gets ONLY the span text — no
 * previous-episode context and no surrounding transcript — so it can't be
 * primed the way the first pass was. Fails open (keeps the span) on error. */
async function verifyDetections(
  ads: DetectedAd[],
  settings: AppSettings,
  guidance?: string | null,
): Promise<DetectedAd[]> {
  const isSuspect = (a: DetectedAd) =>
    a.endTime - a.startTime > SUSPECT_MAX_SECONDS || a.confidence === 'low'

  const kept: DetectedAd[] = []
  for (const a of ads) {
    if (!isSuspect(a)) {
      kept.push(a)
      continue
    }
    const verdict = await verifySegment(a, settings, guidance)
    if (verdict.keep) {
      kept.push(a)
    } else {
      const mins = ((a.endTime - a.startTime) / 60).toFixed(1)
      log.info(
        `verifier rejected ${a.label} (${mins}min, no ad language): "${a.adText.slice(0, 80)}"`,
      )
    }
  }
  return kept
}

async function verifySegment(
  ad: DetectedAd,
  settings: AppSettings,
  guidance?: string | null,
): Promise<{ keep: boolean; evidence: string | null }> {
  const model = getModel(settings)
  const g = guidance?.trim()
    ? `\n\nThe user provided this guidance about this show's ads/promos — weigh it: ${guidance.trim()}`
    : ''
  const prompt = `This span was flagged as a possible "${ad.label}"${
    ad.company ? ` for ${ad.company}` : ''
  }. Is it genuinely an advertisement/promotion, or editorial content?${g}\n\nSpan:\n"""\n${ad.adText.slice(0, 4000)}\n"""`
  try {
    const { object } = await generateObject({
      model,
      schema: VerifierSchema,
      system: VERIFIER_SYSTEM,
      prompt,
    })
    return { keep: object.isAd, evidence: object.evidence }
  } catch (err) {
    log.warn(
      `verifier failed for [${ad.startTime.toFixed(0)}-${ad.endTime.toFixed(0)}], keeping span: ${(err as Error).message}`,
    )
    return { keep: true, evidence: null }
  }
}

/**
 * Merge overlapping detections and map their segment-id ranges back to exact
 * start/end times (and joined ad text) from the transcript. Out-of-range ids
 * are dropped. Pure — the testable heart of the segment-id approach.
 */
export function mapDetectionsToAds(
  detected: DetectedSegment[],
  segments: Transcript['segments'],
): DetectedAd[] {
  const byId = new Map(segments.map((s) => [s.id, s]))
  const merged = mergeOverlaps(detected)
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
    const spanText = segments
      .filter((s) => s.id >= lo && s.id <= hi)
      .map((s) => s.text)
      .join(' ')
    result.push({
      startTime: startSeg.start,
      endTime: endSeg.end,
      label: d.label,
      company: d.company ?? null,
      adText: spanText,
      reason: d.reason ?? '',
      confidence: d.confidence,
    })
  }
  return result
}
