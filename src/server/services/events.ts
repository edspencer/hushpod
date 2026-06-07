import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { events, episodes } from '../db/schema.js'
import {
  TelemetrySchema,
  TELEMETRY_STAGES,
  type Telemetry,
  type TelemetryStage,
} from '../../shared/schemas.js'

export interface EmitOptions {
  showId?: number | null
  durationMs?: number
  data?: Record<string, unknown>
  at?: Date
}

/** Which stage a `<stage>.started|finished` event belongs to. */
function stageOf(type: string): TelemetryStage | null {
  const [stage, phase] = type.split('.')
  if (
    (phase === 'started' || phase === 'finished') &&
    TELEMETRY_STAGES.includes(stage as TelemetryStage)
  )
    return stage as TelemetryStage
  return null
}

export function parseTelemetry(raw: string | null | undefined): Telemetry {
  if (!raw) return { stages: {} }
  try {
    return TelemetrySchema.parse(JSON.parse(raw))
  } catch {
    return { stages: {} }
  }
}

const FACT_KEYS = ['bytes', 'segments', 'model', 'ads', 'removedSec'] as const

/**
 * Fold one event into a telemetry rollup (pure). `<stage>.started` records the
 * start time; `<stage>.finished` records end time, duration, and any facts in
 * `data`. episode.discovered/done/error update the episode-level fields.
 */
export function foldTelemetry(
  prev: Telemetry,
  type: string,
  atMs: number,
  opts: { durationMs?: number; data?: Record<string, unknown> } = {},
): Telemetry {
  const t: Telemetry = { ...prev, stages: { ...prev.stages } }

  if (type === 'episode.discovered') {
    t.discoveredAt = atMs
    return t
  }
  if (type === 'episode.done') {
    t.doneAt = atMs
    t.totalMs = TELEMETRY_STAGES.reduce((sum, k) => sum + (t.stages[k]?.ms ?? 0), 0)
    return t
  }
  if (type === 'episode.error') {
    t.lastError = {
      at: atMs,
      message: String(opts.data?.message ?? 'error'),
      stage: typeof opts.data?.stage === 'string' ? (opts.data.stage as string) : undefined,
    }
    return t
  }

  const stage = stageOf(type)
  if (!stage) return t
  const cur = { ...(t.stages[stage] ?? {}) }
  if (type.endsWith('.started')) {
    cur.startedAt = atMs
    if (stage === 'detect') t.attempts = (t.attempts ?? 0) + 1
  } else {
    cur.endedAt = atMs
    if (opts.durationMs != null) cur.ms = opts.durationMs
    const d = opts.data ?? {}
    for (const key of FACT_KEYS) if (key in d) (cur as Record<string, unknown>)[key] = d[key]
  }
  t.stages[stage] = cur
  return t
}

/**
 * Append an event to the log and fold it into the episode's telemetry rollup in
 * one synchronous write. better-sqlite3 serializes writes and a given episode is
 * only ever in one stage at a time, so the read-modify-write on telemetry is
 * race-free. The live dashboard queue is a real-time view of this same stream.
 */
export function emit(type: string, episodeId: number | null, opts: EmitOptions = {}): void {
  const at = opts.at ?? new Date()
  db.transaction((tx) => {
    tx.insert(events)
      .values({
        episodeId: episodeId ?? null,
        showId: opts.showId ?? null,
        type,
        at,
        durationMs: opts.durationMs ?? null,
        data: opts.data ? JSON.stringify(opts.data) : null,
      })
      .run()

    if (episodeId != null) {
      const row = tx
        .select({ telemetry: episodes.telemetry })
        .from(episodes)
        .where(eq(episodes.id, episodeId))
        .get()
      const next = foldTelemetry(parseTelemetry(row?.telemetry), type, at.getTime(), opts)
      tx.update(episodes)
        .set({ telemetry: JSON.stringify(next) })
        .where(eq(episodes.id, episodeId))
        .run()
    }
  })
}
