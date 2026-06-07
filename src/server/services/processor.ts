import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { and, desc, eq, inArray, lt, ne } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  episodes,
  ads,
  shows,
  type Episode,
  type Show,
  type Ad,
  type EpisodeStatus,
} from '../db/schema.js'
import { episodeDir } from '../lib/config.js'
import { getSettings } from '../lib/settings.js'
import { logger } from '../lib/logger.js'
import { TranscriptSchema, type Transcript } from '../../shared/schemas.js'
import { downloadEpisode } from './downloader.js'
import { transcribe } from '../lib/whisper.js'
import { detectAds } from './detector.js'
import { extendForTransitions } from './transition.js'
import { cutEpisode } from './cutter.js'
import { emit } from './events.js'
import type { TimeRange } from '../lib/ffmpeg.js'

const log = logger('processor')
const MAX_RETRIES = 3

/**
 * A concurrency-limited pipeline stage. Episodes flow through three of these —
 * download → transcribe → detect(+cut) — and each stage runs independently with
 * its own limit. Because the stages use different resources (network, GPU,
 * Ollama), this keeps all three busy at once instead of letting a single
 * whole-episode slot serialize everything. Transcription defaults to a limit of
 * 1 because local whisper mutates process.cwd() and is not parallel-safe.
 */
class Stage {
  private queued = new Set<number>()
  private active = new Set<number>()

  constructor(
    readonly name: string,
    private readonly limit: () => number,
    private readonly worker: (id: number) => Promise<void>,
  ) {}

  enqueue(id: number): void {
    if (this.queued.has(id) || this.active.has(id)) return
    this.queued.add(id)
    this.drain()
  }

  get status(): { queued: number[]; active: number[] } {
    return { queued: [...this.queued], active: [...this.active] }
  }

  private drain(): void {
    const limit = Math.max(1, this.limit())
    while (this.active.size < limit && this.queued.size > 0) {
      const id = this.queued.values().next().value as number
      this.queued.delete(id)
      this.active.add(id)
      void this.execute(id)
    }
  }

  private async execute(id: number): Promise<void> {
    try {
      await this.worker(id)
    } catch (err) {
      await handleFailure(id, err as Error)
    } finally {
      this.active.delete(id)
      this.drain()
    }
  }
}

// Stages are declared before the worker functions; the workers are function
// declarations (hoisted), so passing them here is fine, and each worker's
// reference to the next stage resolves at call time.
const downloadStage = new Stage('download', () => getSettings().downloadConcurrency, runDownload)
const transcribeStage = new Stage(
  'transcribe',
  () => getSettings().transcribeConcurrency,
  runTranscribe,
)
const detectStage = new Stage('detect', () => getSettings().detectConcurrency, runDetect)

function setStatus(id: number, status: EpisodeStatus, fields: Partial<Episode> = {}): void {
  db.update(episodes)
    .set({ status, updatedAt: new Date(), ...fields })
    .where(eq(episodes.id, id))
    .run()
}

function loadEpisodeShow(id: number): { episode: Episode; show: Show } {
  const episode = db.select().from(episodes).where(eq(episodes.id, id)).get()
  if (!episode) throw new Error(`episode ${id} not found`)
  const show = db.select().from(shows).where(eq(shows.id, episode.showId)).get()
  if (!show) throw new Error(`show ${episode.showId} not found`)
  return { episode, show }
}

/* ------------------------------------------------------------------ *
 * Stage workers — each does its step, then hands the episode to the next
 * stage. Steps are idempotent: a worker skips its work if its output already
 * exists, so a re-queued or reprocessed episode resumes from the right place.
 * ------------------------------------------------------------------ */

async function runDownload(id: number): Promise<void> {
  const { episode, show } = loadEpisodeShow(id)
  await mkdir(episodeDir(show.slug, episode.guid), { recursive: true })

  if (!episode.originalPath || !existsSync(episode.originalPath)) {
    setStatus(id, 'downloading')
    emit('download.started', id, { showId: show.id })
    const t0 = Date.now()
    const dl = await downloadEpisode(episode.sourceUrl, show.slug, episode.guid)
    setStatus(id, 'downloading', { originalPath: dl.path, originalSize: dl.size })
    emit('download.finished', id, {
      showId: show.id,
      durationMs: Date.now() - t0,
      data: { bytes: dl.size },
    })
  }
  // Back to 'pending' until a transcribe slot frees up, so the queue shows it as
  // waiting rather than stuck mid-download.
  setStatus(id, 'pending')
  transcribeStage.enqueue(id)
}

async function runTranscribe(id: number): Promise<void> {
  const { episode } = loadEpisodeShow(id)
  const settings = getSettings()

  if (!episode.transcript) {
    if (!episode.originalPath || !existsSync(episode.originalPath)) {
      throw new Error('cannot transcribe: original audio missing')
    }
    setStatus(id, 'transcribing')
    emit('transcribe.started', id, { showId: episode.showId })
    const t0 = Date.now()
    const transcript = await transcribe(episode.originalPath, settings)
    const duration = episode.duration ?? transcript.durationSec ?? null
    setStatus(id, 'transcribing', { transcript: JSON.stringify(transcript), duration })
    emit('transcribe.finished', id, {
      showId: episode.showId,
      durationMs: Date.now() - t0,
      data: { segments: transcript.segments.length, model: settings.whisperModel },
    })
  }
  // Back to 'pending' until a detect slot frees up.
  setStatus(id, 'pending')
  detectStage.enqueue(id)
}

async function runDetect(id: number): Promise<void> {
  const { episode, show } = loadEpisodeShow(id)
  const settings = getSettings()
  const dir = episodeDir(show.slug, episode.guid)
  await mkdir(dir, { recursive: true })

  if (!episode.transcript) throw new Error('cannot detect: transcript missing')
  if (!episode.originalPath || !existsSync(episode.originalPath)) {
    throw new Error('cannot cut: original audio missing')
  }
  const transcript: Transcript = TranscriptSchema.parse(JSON.parse(episode.transcript))
  const duration =
    episode.duration ?? transcript.durationSec ?? transcript.segments.at(-1)?.end ?? 0

  // Detect.
  setStatus(id, 'detecting')
  emit('detect.started', id, { showId: show.id })
  const tDetect = Date.now()
  const prevAds = previousEpisodeAds(show, episode)
  const prevTranscripts = previousEpisodeTranscripts(show, episode)
  const detected = await detectAds(
    transcript,
    settings,
    prevAds,
    show.detectionGuidance,
    prevTranscripts,
  )

  db.delete(ads).where(eq(ads.episodeId, id)).run()
  if (detected.length > 0) {
    db.insert(ads)
      .values(
        detected.map((d) => ({
          episodeId: id,
          showId: show.id,
          startTime: d.startTime,
          endTime: d.endTime,
          label: d.label,
          company: d.company,
          adText: d.adText,
          reason: d.reason,
        })),
      )
      .run()
  }

  emit('detect.finished', id, {
    showId: show.id,
    durationMs: Date.now() - tDetect,
    data: { ads: detected.length },
  })

  // Cut — only the labels this show wants removed.
  setStatus(id, 'cutting')
  emit('cut.started', id, { showId: show.id })
  const tCut = Date.now()
  const cutLabels = labelsToCut(show)
  let cuts: TimeRange[] = detected
    .filter((d) => cutLabels.has(d.label))
    .map((d) => ({ start: d.startTime, end: d.endTime }))
  cuts = await extendForTransitions(episode.originalPath, cuts, duration, settings)

  const cleanPath = join(dir, 'clean.mp3')
  const cut = await cutEpisode(episode.originalPath, cleanPath, cuts, duration, settings)

  setStatus(id, 'done', {
    cleanPath: cut.path,
    cleanSize: cut.size,
    duration,
    errorMessage: null,
  })
  emit('cut.finished', id, {
    showId: show.id,
    durationMs: Date.now() - tCut,
    data: { removedSec: Math.round(cut.removedSeconds) },
  })
  emit('episode.done', id, { showId: show.id })
  log.info(
    `episode ${id} "${episode.title}" done (${detected.length} segments, -${cut.removedSeconds.toFixed(0)}s)`,
  )
}

/* ------------------------------------------------------------------ *
 * Routing, failure handling, and the public queue facade.
 * ------------------------------------------------------------------ */

/** Which stage an episode should (re)enter, given what work is already done. */
export function pickStage(hasOriginal: boolean, hasTranscript: boolean): Stage['name'] {
  if (!hasOriginal) return 'download'
  if (!hasTranscript) return 'transcribe'
  return 'detect'
}

/** Send an episode into the pipeline at the right stage for its current state. */
function routeEpisode(id: number): void {
  const ep = db.select().from(episodes).where(eq(episodes.id, id)).get()
  if (!ep) return
  const hasOriginal = !!ep.originalPath && existsSync(ep.originalPath)
  const stage = pickStage(hasOriginal, !!ep.transcript)
  if (stage === 'download') downloadStage.enqueue(id)
  else if (stage === 'transcribe') transcribeStage.enqueue(id)
  else detectStage.enqueue(id)
}

async function handleFailure(id: number, err: Error): Promise<void> {
  const ep = db.select().from(episodes).where(eq(episodes.id, id)).get()
  const retryCount = (ep?.retryCount ?? 0) + 1
  setStatus(id, 'error', { errorMessage: err.message.slice(0, 1000), retryCount })
  emit('episode.error', id, {
    showId: ep?.showId ?? null,
    data: { message: err.message.slice(0, 300) },
  })
  log.error(`episode ${id} failed: ${err.message}`)

  if (retryCount <= MAX_RETRIES) {
    const delayMs = Math.min(60_000, 2 ** retryCount * 1000)
    log.warn(`episode ${id} retry ${retryCount}/${MAX_RETRIES} in ${delayMs}ms`)
    setTimeout(() => {
      setStatus(id, 'pending')
      routeEpisode(id)
    }, delayMs)
  }
}

/**
 * Public facade kept stable for callers (routes, startup). `enqueue` routes an
 * episode to the correct stage; `status` aggregates all stages so the dashboard
 * sees one combined queue (active work across every stage, then everything
 * waiting).
 */
export const queue = {
  enqueue(id: number): void {
    routeEpisode(id)
  },
  get status(): { queued: number[]; active: number[] } {
    const d = downloadStage.status
    const t = transcribeStage.status
    const x = detectStage.status
    // Active ordered most-advanced first (detect → transcribe → download) so the
    // closest-to-done sits at the top of the dashboard queue table.
    return {
      active: [...x.active, ...t.active, ...d.active],
      queued: [...x.queued, ...t.queued, ...d.queued],
    }
  },
}

export type StageName = 'download' | 'transcribe' | 'detect'
export interface QueueEntry {
  id: number
  stage: StageName
  state: 'active' | 'queued'
}

/** Ordered view of the whole pipeline for the dashboard: every active episode
 * (most-advanced stage first), then everything waiting, each tagged with the
 * stage it's in — so a downloaded episode waiting for the GPU reads as "queued
 * for transcribe" rather than an indistinct "pending". */
export function queueSnapshot(): QueueEntry[] {
  const stages: [StageName, Stage][] = [
    ['detect', detectStage],
    ['transcribe', transcribeStage],
    ['download', downloadStage],
  ]
  const out: QueueEntry[] = []
  for (const [stage, s] of stages)
    for (const id of s.status.active) out.push({ id, stage, state: 'active' })
  for (const [stage, s] of stages)
    for (const id of s.status.queued) out.push({ id, stage, state: 'queued' })
  return out
}

/** Trigger a reprocess from the detection step (keeps original + transcript). */
export function reprocessEpisode(id: number): void {
  db.update(episodes)
    .set({ status: 'pending', errorMessage: null, retryCount: 0, updatedAt: new Date() })
    .where(eq(episodes.id, id))
    .run()
  routeEpisode(id)
}

/** On startup: reset in-flight episodes to pending and re-enter them at the
 * appropriate stage based on the work already on disk. */
export function resumePending(): void {
  const inFlight: EpisodeStatus[] = ['downloading', 'transcribing', 'detecting', 'cutting']
  db.update(episodes).set({ status: 'pending' }).where(inArray(episodes.status, inFlight)).run()

  const pending = db
    .select({ id: episodes.id })
    .from(episodes)
    .where(eq(episodes.status, 'pending'))
    .all()
  for (const { id } of pending) routeEpisode(id)
  if (pending.length > 0) log.info(`resumed ${pending.length} pending episode(s)`)
}

/* ------------------------------------------------------------------ *
 * Detection context helpers (unchanged behavior).
 * ------------------------------------------------------------------ */

/** Find the most recent prior episode (by publish date) of the same show that
 * has detected ads — used as detection context. */
function previousEpisodeAds(show: Show, current: Episode): Ad[] {
  const prior = db
    .select()
    .from(episodes)
    .where(
      and(
        eq(episodes.showId, show.id),
        ne(episodes.id, current.id),
        current.publishedAt ? lt(episodes.publishedAt, current.publishedAt) : undefined,
      ),
    )
    .orderBy(desc(episodes.publishedAt))
    .all()

  for (const ep of prior) {
    const epAds = db.select().from(ads).where(eq(ads.episodeId, ep.id)).all()
    if (epAds.length > 0) return epAds
  }
  return []
}

/** The transcripts of the most recent prior episodes of the same show, used for
 * cross-episode recurrence ("fluff") detection. */
function previousEpisodeTranscripts(show: Show, current: Episode, limit = 4): Transcript[] {
  const prior = db
    .select({ transcript: episodes.transcript })
    .from(episodes)
    .where(
      and(
        eq(episodes.showId, show.id),
        ne(episodes.id, current.id),
        current.publishedAt ? lt(episodes.publishedAt, current.publishedAt) : undefined,
      ),
    )
    .orderBy(desc(episodes.publishedAt))
    .limit(limit)
    .all()

  const out: Transcript[] = []
  for (const { transcript } of prior) {
    if (!transcript) continue
    try {
      out.push(TranscriptSchema.parse(JSON.parse(transcript)))
    } catch {
      /* skip unparseable transcript */
    }
  }
  return out
}

/** Which segment labels should be cut, given a show's settings. Each removable
 * class has its own independent toggle. "fluff" (recurring show scaffolding) is
 * detected always but cut only when the user opts in. */
function labelsToCut(show: Show): Set<string> {
  const set = new Set<string>()
  if (show.removeAds) set.add('ad')
  if (show.removePromos) set.add('promo')
  if (show.removeFluff) set.add('fluff')
  return set
}
