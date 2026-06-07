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
import { findRecurringSpans, type RecurringSpan } from './recurrence.js'
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

const SYSTEM_PROMPT = `You classify the parts of a podcast transcript so the non-content parts can be removed.

You receive the transcript as a numbered list of segments, one per line:
[<id>] <text>

Classify every part into exactly ONE of three categories. Return ONLY the "ad" and "fluff" spans (content is everything else and is never returned). For each returned span give the id of its FIRST and LAST segment (inclusive).

CATEGORIES
- "content" — the actual episode: the news, story, interview, narration, analysis, jokes, the quiz/game. This is what the listener came for. NEVER return it. (It is content even when it names brands, products, companies, or the episode's own topic.)
- "ad" — ANY paid or promotional material: a third-party sponsor read, a cross-promotion for another show, OR a plug to buy/subscribe/support/sign-up for something (a newsletter, book, app, membership/ad-free tier, live-show tickets, merch, another podcast). If it pushes the listener toward a purchase, a signup, a website, a promo code, or another property, it is an ad.
- "fluff" — recurring, NON-commercial show scaffolding that is the same most weeks: the host billboard/show open, a "here's how this show works" explainer, a recurring legal/medical disclaimer, the sign-off, the production-credits roll, station identification, the call-in line, and "follow/rate/review us" housekeeping. Fluff sells nothing.

EXAMPLES — these are "ad" (return them):
- "This message comes from NPR sponsor Charles Schwab. Learn more at Schwab.com."
- "Support for this podcast and the following message come from DataIQ, the data quality company."
- "This episode is brought to you by SoFi. Fast funds, terms apply, at sofi.com/show."
- "Ever invest in something that seemed incredible at first but didn't live up to the hype? LinkedIn has a word for that. Cut the bullspend. Go to LinkedIn.com/show." (a host-read native ad — no "sponsored by" frame, but it sells LinkedIn)
- "This is a paid ad by BetterHelp. Sign up and get 10% off at betterhelp.com/show."
- "Use code SHOW for 20% off your first order. That's example.com, code SHOW."
- "Zepbound is a prescription medicine. Talk to your doctor. Learn more at zepbound.lilly.com." (a DTC pharma read)
- "Spring is a time to refresh the things you use every day — even your socks. That's why I love Bombas." (a conversational native read with no URL)
- "This week on the NPR Politics Podcast, we break down the primaries. Listen wherever you get your podcasts." (a cross-promo for another show)
- "Want to listen to this show sponsor-free? Get NPR+ at plus.npr.org." (a paid-tier / ad-free upsell)
- "Don't forget to sign up for my newsletter — it's free at example.com or on Substack." (a self-promo signup plug)
- "Come see us live! We'll be at the Riverside Theater in Milwaukee. Tickets at example.org." (a live-show / ticket plug)
- "Pick up my new book, 'Protocols', available everywhere books are sold." (a book plug)
- A comedian delivering a jokey sponsor read is STILL an ad if it names a sponsor and a CTA/URL.

EXAMPLES — these are "fluff" (return them):
- "I'm Steve Inskeep with A. Martinez, and this is Up First from NPR News." (host billboard)
- "Welcome to Stuff You Should Know, a production of iHeartRadio." (show open)
- "Welcome to the Huberman Lab Podcast, where we discuss science and science-based tools for everyday life." (recurring intro spiel)
- "This podcast is presented solely for educational and entertainment purposes. I'm not a licensed therapist." (recurring disclaimer)
- "That's our show for today. It was produced by… edited by… Our technical director is…" (credits roll)
- "Thanks for listening. Join us again tomorrow." (sign-off)
- "If you'd like to play on the air, call us at 1-888-WAIT-WAIT." (recurring call-in line)
- "Follow us on Instagram @show, and rate and review us wherever you listen." (recurring housekeeping that sells nothing)
- "Tonight I'll read you a story, then read it again a little slower, to help you fall asleep." (recurring "how this show works" explainer)
- "Stay with us." / "We'll be right back." / "And now, back to the show." (break bumpers)

EXAMPLES — these are "content" (do NOT return):
- A founder describing their own company: "So we started the company in a garage in 2009…"
- A host mentioning a brand in a story: "She drove a Tesla to the lake house that night."
- News about a company: "Apple reported record earnings on Tuesday."
- A cold open unique to THIS episode (even if it sounds structural): "Today, the strange story of a missing painting."
- The quiz, the interview answers, the narration — the substance of the episode.
- A comedic aside like "you've got to see the video of this on YouTube" with no signup/URL push.

SPLITTING — this matters a lot:
- Ad breaks usually STACK several different sponsors back-to-back. Return ONE separate "ad" span PER sponsor, each from its own opening line to its own closing line/URL. Do NOT merge a 3-sponsor break into one span. (e.g. an AT&T read, then a Bank of America read, then a GoodRx read = THREE ad spans.)
- Set "company" to each sponsor's own name.

BOUNDARIES:
- Include the WHOLE read: start at the ad's first lead-in sentence (often a question or a "let's take a break"-style pivot is content, but the first line that starts selling is the ad), and end at its final URL/price/disclaimer line. Do not clip the opening or the trailing URL.
- Do NOT bleed into content: stop before the host resumes the story ("we're back…", "back to the show").
- Scan the ENTIRE episode, including AFTER the sign-off/credits — trailing post-credits ad pods are common.
- Catch EVERY occurrence: if the same plug airs twice, return both; if an ad sits in the gap between two other ad pods, return it too.

CRITICAL — protect content:
- Never return content. Interview/story/analysis is content even when it names brands.
- Be very suspicious of any single ad span longer than ~5 minutes — real reads are seconds to ~3 minutes. A long span almost always means you swallowed content; only return it if it is wall-to-wall sponsor copy.

OUTPUT RULES:
- Refer to segments ONLY by their [id]. Never invent timestamps.
- "company": the sponsor/product name ONLY if named in THIS transcript, else null. Never carry an advertiser over from another episode.
- "confidence": high only with explicit ad/scaffolding cues; medium if likely; low if uncertain.
- "reason": one short sentence citing the cue you found.`

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
  return `\nShow-specific guidance from the user — follow this carefully, it describes how THIS show's ads behave:\n${g}\n`
}

/** Tell the model which spans recur near-verbatim across episodes — these are
 * almost certainly "fluff" (show scaffolding). The model still gets to split out
 * any third-party ad/promo embedded inside them. Only spans overlapping the
 * current window are shown. */
function renderRecurring(spans: RecurringSpan[], windowSegments: Transcript['segments']): string {
  if (spans.length === 0 || windowSegments.length === 0) return ''
  const lo = windowSegments[0]!.id
  const hi = windowSegments[windowSegments.length - 1]!.id
  const inWindow = spans.filter((s) => s.endSegmentId >= lo && s.startSegmentId <= hi)
  if (inWindow.length === 0) return ''
  const lines = inWindow
    .map((s) => `- segments [${s.startSegmentId}]–[${s.endSegmentId}]: "${s.text.slice(0, 160)}"`)
    .join('\n')
  return `\nRecurring boilerplate: the following spans appear near-verbatim in previous episodes of this show, so they are almost certainly "fluff" (standard intro/sign-off/credits/housekeeping). Label them "fluff" UNLESS part of the span is a sponsor read or promotional plug — in that case label that part "ad" and the surrounding boilerplate "fluff":\n${lines}\n`
}

function buildUserPrompt(
  segments: Transcript['segments'],
  previousAds: Ad[],
  recurring: RecurringSpan[],
  guidance?: string | null,
): string {
  return `${renderGuidance(guidance)}${renderPreviousAds(previousAds)}${renderRecurring(
    recurring,
    segments,
  )}\nTranscript:\n${renderTranscript(segments)}`
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
  recurring: RecurringSpan[],
  guidance?: string | null,
): Promise<DetectedSegment[]> {
  const model = getModel(settings)
  const prompt = buildUserPrompt(segments, previousAds, recurring, guidance)

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
      system: `${SYSTEM_PROMPT}\n\nRespond with ONLY a JSON object: {"segments":[{"startSegmentId":N,"endSegmentId":N,"label":"ad|fluff","company":string|null,"reason":string,"confidence":"low|medium|high"}]}. No prose, no markdown.`,
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
  previousTranscripts: Transcript[] = [],
): Promise<DetectedAd[]> {
  const segs = transcript.segments
  if (segs.length === 0) return []

  // Cross-episode recurrence: spans whose wording repeats across recent episodes
  // are high-confidence "fluff" candidates. Fed to the LLM as priors, and any it
  // ignores are added back as fluff (see addUncoveredFluff).
  const recurring = findRecurringSpans(transcript, previousTranscripts)
  if (recurring.length > 0) log.info(`found ${recurring.length} recurring span(s) across episodes`)

  const raw: DetectedSegment[] = []

  for (let i = 0; i < segs.length; i += WINDOW_SEGMENTS - WINDOW_OVERLAP) {
    const window = segs.slice(i, i + WINDOW_SEGMENTS)
    if (window.length === 0) break
    log.info(`detecting window ${i}-${i + window.length} of ${segs.length} segments`)
    const found = await detectWindow(settings, window, previousAds, recurring, guidance)
    raw.push(...found)
    if (i + WINDOW_SEGMENTS >= segs.length) break
  }

  const withFluff = addUncoveredFluff(raw, recurring)
  const mapped = mapDetectionsToAds(withFluff, segs)
  const verified = await verifyDetections(mapped, settings, guidance)
  const reconciled = verified.map(reclassifyFluff)
  log.info(`detected ${mapped.length} segment(s); kept ${verified.length} after verification`)
  return reconciled
}

// Recurring sponsor reads and cross-promos repeat across episodes too, so
// recurrence can sweep them into "fluff" — and a weak model may not split them
// back out. That would let a real ad survive on a show where only removeAds is
// on. These cues reclassify an ad-bearing "fluff" span back to "ad" so the
// removeAds toggle still catches it. Pure scaffolding (billboards, credits,
// sign-offs, "follow/rate us") has none of these commercial cues and stays fluff.
const AD_CUES =
  /\b(this message comes from|support for .{0,40}comes from|sponsored by|brought to you by|use (?:the )?(?:code|promo)|promo code|wherever you get your podcasts|sponsor[- ]free|without sponsor breaks|npr\+|plus\.npr\.org)\b|[a-z0-9-]+\.(?:com|org|net|co|ai)\/[a-z0-9]/i

/** Re-label a "fluff" span back to "ad" when it clearly contains a sponsor read
 * or promotional plug (see AD_CUES). Non-fluff spans pass through unchanged. */
export function reclassifyFluff(ad: DetectedAd): DetectedAd {
  if (ad.label !== 'fluff') return ad
  return AD_CUES.test(ad.adText ?? '') ? { ...ad, label: 'ad' } : ad
}

/** Add recurring spans the LLM didn't touch as "fluff". A recurring span is
 * considered handled if any LLM detection overlaps its id-range (the model may
 * have split it into ad/promo + fluff); otherwise we add it ourselves so
 * recurrence-detected boilerplate is never silently dropped. */
export function addUncoveredFluff(
  detected: DetectedSegment[],
  recurring: RecurringSpan[],
): DetectedSegment[] {
  const overlaps = (s: RecurringSpan) =>
    detected.some((d) => d.endSegmentId >= s.startSegmentId && d.startSegmentId <= s.endSegmentId)
  const added: DetectedSegment[] = recurring
    .filter((s) => !overlaps(s))
    .map((s) => ({
      startSegmentId: s.startSegmentId,
      endSegmentId: s.endSegmentId,
      label: 'fluff' as const,
      company: null,
      reason: 'Recurs near-verbatim across episodes of this show',
      confidence: 'high' as const,
    }))
  return [...detected, ...added]
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
  // The verifier audits for ad LANGUAGE, so it only applies to ad/promo. Fluff
  // is recurring scaffolding (often long, with no ad cues) — auditing it for ad
  // language would wrongly drop it, so it bypasses verification entirely.
  const isSuspect = (a: DetectedAd) =>
    a.label !== 'fluff' && (a.endTime - a.startTime > SUSPECT_MAX_SECONDS || a.confidence === 'low')

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
