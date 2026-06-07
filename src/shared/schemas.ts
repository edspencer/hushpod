import { z } from 'zod'

/* ------------------------------------------------------------------ *
 * Transcript
 * ------------------------------------------------------------------ */

/**
 * One timestamped segment from whisper. `id` is a stable, monotonically
 * increasing index we assign across the whole episode (after chunk merging),
 * so the LLM can refer to segments by id instead of inventing timestamps.
 */
export const TranscriptSegmentSchema = z.object({
  id: z.number().int().nonnegative(),
  start: z.number(), // seconds
  end: z.number(), // seconds
  text: z.string(),
})
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>

export const TranscriptSchema = z.object({
  language: z.string().optional(),
  durationSec: z.number().optional(),
  segments: z.array(TranscriptSegmentSchema),
})
export type Transcript = z.infer<typeof TranscriptSchema>

/* ------------------------------------------------------------------ *
 * Ad detection — LLM output
 *
 * The LLM is BAD at emitting precise float timestamps and will hallucinate
 * values outside the episode. Instead it returns segment-id RANGES; we map
 * those back to exact start/end times from the whisper transcript ourselves.
 * ------------------------------------------------------------------ */

// Three-way classification of every part of an episode:
// - "content" = the actual episode (editorial) — NEVER flagged/removed, so it is
//   not a stored label; it's simply everything we don't return.
// - "ad"   = any paid or promotional material: third-party sponsor reads,
//   cross-promotions for other shows, membership/subscribe/newsletter/book/ticket
//   plugs — anything pushing a purchase, signup, or another property.
// - "fluff" = recurring, non-commercial show scaffolding (intro spiel, "how this
//   show works", disclaimers, sign-off, credits, call-in line, follow/rate-us).
export const AD_LABELS = ['ad', 'fluff'] as const
export type AdLabelValue = (typeof AD_LABELS)[number]

export const DetectedSegmentSchema = z.object({
  startSegmentId: z
    .number()
    .int()
    .nonnegative()
    .describe('id of the first transcript segment in this span'),
  endSegmentId: z
    .number()
    .int()
    .nonnegative()
    .describe('id of the last transcript segment in this span (inclusive)'),
  label: z.enum(AD_LABELS),
  company: z
    .string()
    .nullable()
    .optional()
    .describe('Advertiser/company name ONLY if named in THIS transcript, else null'),
  reason: z.string().optional().describe('Brief explanation of why this span is an ad or fluff'),
  confidence: z
    .enum(['low', 'medium', 'high'])
    .optional()
    .describe('high only when there is explicit ad language; medium if likely; low if uncertain'),
})
export type DetectedSegment = z.infer<typeof DetectedSegmentSchema>

export const DetectionResultSchema = z.object({
  segments: z.array(DetectedSegmentSchema),
})
export type DetectionResult = z.infer<typeof DetectionResultSchema>

/* ------------------------------------------------------------------ *
 * Episode telemetry — a derived rollup of the event log, stored as JSON on the
 * episode. Timestamps are epoch milliseconds. Folded by services/events.ts.
 * ------------------------------------------------------------------ */

export const StageTelemetrySchema = z
  .object({
    startedAt: z.number(),
    endedAt: z.number(),
    ms: z.number(),
    bytes: z.number(), // download
    segments: z.number(), // transcribe
    model: z.string(), // transcribe
    ads: z.number(), // detect
    inputTokens: z.number(), // detect (LLM)
    outputTokens: z.number(), // detect (LLM)
    costUsd: z.number(), // detect (LLM) — estimated
    removedSec: z.number(), // cut
  })
  .partial()
export type StageTelemetry = z.infer<typeof StageTelemetrySchema>

export const TelemetrySchema = z.object({
  discoveredAt: z.number().optional(),
  stages: z
    .object({
      download: StageTelemetrySchema.optional(),
      transcribe: StageTelemetrySchema.optional(),
      detect: StageTelemetrySchema.optional(),
      cut: StageTelemetrySchema.optional(),
    })
    .default({}),
  doneAt: z.number().optional(),
  totalMs: z.number().optional(),
  costUsd: z.number().optional(),
  attempts: z.number().optional(),
  lastError: z
    .object({ at: z.number(), message: z.string(), stage: z.string().optional() })
    .optional(),
})
export type Telemetry = z.infer<typeof TelemetrySchema>
export const TELEMETRY_STAGES = ['download', 'transcribe', 'detect', 'cut'] as const
export type TelemetryStage = (typeof TELEMETRY_STAGES)[number]

/* ------------------------------------------------------------------ *
 * Application settings (stored as key/value strings in the DB)
 *
 * Values arrive from two sources: the DB (always strings) and API PATCH
 * bodies (real JSON types). The coercion below accepts both. Note: we cannot
 * use z.coerce.boolean(), which treats the string "false" as truthy.
 * ------------------------------------------------------------------ */

const zBool = (def: boolean) =>
  z
    .preprocess((v) => {
      if (typeof v === 'boolean') return v
      if (typeof v === 'string') return v === 'true' || v === '1'
      return v
    }, z.boolean())
    .default(def)

export const SettingsSchema = z.object({
  // Transcription
  whisperMode: z.enum(['local', 'remote']).default('local'),
  whisperModel: z.string().default('base'),
  whisperEndpoint: z.string().default(''), // OpenAI-compatible /v1/audio/transcriptions base URL
  whisperApiKey: z.string().default(''),

  // LLM ad detection
  llmProvider: z
    .enum(['openai-compatible', 'openai', 'anthropic', 'ollama'])
    .default('openai-compatible'),
  llmBaseUrl: z.string().default('http://localhost:11434/v1'),
  llmApiKey: z.string().default(''),
  llmModel: z.string().default('llama3.1'),

  // Pipeline — per-stage concurrency. Each stage uses a different resource, so
  // they run independently: downloads are network-bound (parallel-friendly),
  // transcription is GPU/whisper-bound and not safe to run in parallel (whisper
  // mutates process.cwd()), detection is Ollama-bound.
  checkIntervalMinutes: z.coerce.number().int().positive().default(60),
  downloadConcurrency: z.coerce.number().int().positive().default(3),
  transcribeConcurrency: z.coerce.number().int().positive().default(1),
  detectConcurrency: z.coerce.number().int().positive().default(2),
  crossfadeMs: z.coerce.number().nonnegative().default(0),

  // Serving
  baseUrl: z.string().default('http://localhost:3000'),

  // Transition sound detection
  enableTransitionDetection: zBool(true),
  transitionWindowSeconds: z.coerce.number().nonnegative().default(5),
  transitionEnergyThreshold: z.coerce.number().positive().default(2.5),
})
export type AppSettings = z.infer<typeof SettingsSchema>

/** Partial update accepted by PATCH /api/settings. */
export const SettingsUpdateSchema = SettingsSchema.partial()
export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>

/* ------------------------------------------------------------------ *
 * API request bodies
 * ------------------------------------------------------------------ */

export const CreateShowSchema = z.object({
  // Accepts a feed URL, an Apple Podcasts URL/id, or a show's website — the
  // server resolves it to an actual RSS feed URL.
  feedUrl: z.string().trim().min(1),
})

export const UpdateShowSchema = z.object({
  isActive: z.boolean().optional(),
  episodeLimit: z.number().int().positive().optional(),
  removeAds: z.boolean().optional(),
  removeFluff: z.boolean().optional(),
  detectionGuidance: z.string().max(4000).nullable().optional(),
})
