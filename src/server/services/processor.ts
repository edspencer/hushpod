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
import type { TimeRange } from '../lib/ffmpeg.js'

const log = logger('processor')
const MAX_RETRIES = 3

/** In-memory FIFO queue with a configurable concurrency limit. */
class ProcessQueue {
  private queued = new Set<number>()
  private active = new Set<number>()

  enqueue(episodeId: number): void {
    if (this.queued.has(episodeId) || this.active.has(episodeId)) return
    this.queued.add(episodeId)
    this.drain()
  }

  get status() {
    return { queued: [...this.queued], active: [...this.active] }
  }

  private drain(): void {
    const concurrency = getSettings().concurrency
    while (this.active.size < concurrency && this.queued.size > 0) {
      const next = this.queued.values().next().value as number
      this.queued.delete(next)
      this.active.add(next)
      void this.run(next)
    }
  }

  private async run(episodeId: number): Promise<void> {
    try {
      await processEpisode(episodeId)
    } catch (err) {
      log.error(`episode ${episodeId} failed: ${(err as Error).message}`)
    } finally {
      this.active.delete(episodeId)
      this.drain()
    }
  }
}

export const queue = new ProcessQueue()

function setStatus(id: number, status: EpisodeStatus, fields: Partial<Episode> = {}): void {
  db.update(episodes)
    .set({ status, updatedAt: new Date(), ...fields })
    .where(eq(episodes.id, id))
    .run()
}

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

/** Which ad labels should be cut, given a show's settings. */
function labelsToCut(show: Show): Set<string> {
  const set = new Set<string>()
  if (show.removeAds) {
    set.add('ad')
    set.add('intro')
    set.add('outro')
  }
  if (show.removePromos) set.add('promo')
  return set
}

/**
 * Run an episode through the pipeline. Idempotent and resumable: steps are
 * skipped when their output already exists (download/transcribe), so a reprocess
 * re-runs only detection + cutting.
 */
export async function processEpisode(episodeId: number): Promise<void> {
  const episode = db.select().from(episodes).where(eq(episodes.id, episodeId)).get()
  if (!episode) throw new Error(`episode ${episodeId} not found`)
  const show = db.select().from(shows).where(eq(shows.id, episode.showId)).get()
  if (!show) throw new Error(`show ${episode.showId} not found`)

  const settings = getSettings()
  const dir = episodeDir(show.slug, episode.guid)
  await mkdir(dir, { recursive: true })

  try {
    // 1. Download (skip if we already have the original on disk).
    let originalPath = episode.originalPath
    if (!originalPath || !existsSync(originalPath)) {
      setStatus(episodeId, 'downloading')
      const dl = await downloadEpisode(episode.sourceUrl, show.slug, episode.guid)
      originalPath = dl.path
      setStatus(episodeId, 'downloading', { originalPath: dl.path, originalSize: dl.size })
    }

    // 2. Transcribe (skip if we already have a transcript).
    let transcript: Transcript
    if (episode.transcript) {
      transcript = TranscriptSchema.parse(JSON.parse(episode.transcript))
    } else {
      setStatus(episodeId, 'transcribing')
      transcript = await transcribe(originalPath, settings)
      const duration = episode.duration ?? transcript.durationSec ?? null
      setStatus(episodeId, 'transcribing', { transcript: JSON.stringify(transcript), duration })
    }
    const duration =
      episode.duration ?? transcript.durationSec ?? transcript.segments.at(-1)?.end ?? 0

    // 3. Detect ads.
    setStatus(episodeId, 'detecting')
    const prevAds = previousEpisodeAds(show, episode)
    const detected = await detectAds(transcript, settings, prevAds)

    // Replace any prior ad records for this episode.
    db.delete(ads).where(eq(ads.episodeId, episodeId)).run()
    if (detected.length > 0) {
      db.insert(ads)
        .values(
          detected.map((d) => ({
            episodeId,
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

    // 4. Cut — only the labels this show wants removed.
    setStatus(episodeId, 'cutting')
    const cutLabels = labelsToCut(show)
    let cuts: TimeRange[] = detected
      .filter((d) => cutLabels.has(d.label))
      .map((d) => ({ start: d.startTime, end: d.endTime }))
    cuts = await extendForTransitions(originalPath, cuts, duration, settings)

    const cleanPath = join(dir, 'clean.mp3')
    const cut = await cutEpisode(originalPath, cleanPath, cuts, duration, settings)

    setStatus(episodeId, 'done', {
      cleanPath: cut.path,
      cleanSize: cut.size,
      duration,
      errorMessage: null,
    })
    log.info(
      `episode ${episodeId} "${episode.title}" done (${detected.length} ads, -${cut.removedSeconds.toFixed(0)}s)`,
    )
  } catch (err) {
    await handleFailure(episodeId, err as Error)
    throw err
  }
}

async function handleFailure(episodeId: number, err: Error): Promise<void> {
  const ep = db.select().from(episodes).where(eq(episodes.id, episodeId)).get()
  const retryCount = (ep?.retryCount ?? 0) + 1
  setStatus(episodeId, 'error', { errorMessage: err.message.slice(0, 1000), retryCount })

  if (retryCount <= MAX_RETRIES) {
    const delayMs = Math.min(60_000, 2 ** retryCount * 1000)
    log.warn(`episode ${episodeId} retry ${retryCount}/${MAX_RETRIES} in ${delayMs}ms`)
    setTimeout(() => {
      setStatus(episodeId, 'pending')
      queue.enqueue(episodeId)
    }, delayMs)
  }
}

/** Trigger a reprocess from the detection step (keeps original + transcript). */
export function reprocessEpisode(episodeId: number): void {
  db.update(episodes)
    .set({ status: 'pending', errorMessage: null, retryCount: 0, updatedAt: new Date() })
    .where(eq(episodes.id, episodeId))
    .run()
  queue.enqueue(episodeId)
}

/** On startup: reset in-flight episodes to pending and enqueue all pending. */
export function resumePending(): void {
  const inFlight: EpisodeStatus[] = ['downloading', 'transcribing', 'detecting', 'cutting']
  db.update(episodes).set({ status: 'pending' }).where(inArray(episodes.status, inFlight)).run()

  const pending = db
    .select({ id: episodes.id })
    .from(episodes)
    .where(eq(episodes.status, 'pending'))
    .all()
  for (const { id } of pending) queue.enqueue(id)
  if (pending.length > 0) log.info(`resumed ${pending.length} pending episode(s)`)
}
