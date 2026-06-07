import { Hono } from 'hono'
import { eq, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { episodes, ads, shows } from '../db/schema.js'
import { queue, reprocessEpisode } from '../services/processor.js'
import { sanitizeGuid } from '../lib/config.js'
import { TranscriptSchema } from '../../shared/schemas.js'

export const episodesRoute = new Hono()

/** List episodes for a show: GET /api/shows/:showId/episodes */
episodesRoute.get('/shows/:showId/episodes', (c) => {
  const showId = Number(c.req.param('showId'))
  const rows = db
    .select()
    .from(episodes)
    .where(eq(episodes.showId, showId))
    .orderBy(desc(episodes.publishedAt))
    .all()
  return c.json(rows)
})

/** Episode detail including its ads: GET /api/episodes/:id */
episodesRoute.get('/episodes/:id', (c) => {
  const id = Number(c.req.param('id'))
  const episode = db.select().from(episodes).where(eq(episodes.id, id)).get()
  if (!episode) return c.json({ error: 'not found' }, 404)
  const show = db
    .select({ slug: shows.slug, title: shows.title })
    .from(shows)
    .where(eq(shows.id, episode.showId))
    .get()
  const episodeAds = db.select().from(ads).where(eq(ads.episodeId, id)).orderBy(ads.startTime).all()
  // Omit the (large) transcript from the detail payload by default.
  const { transcript, ...rest } = episode
  const guid = sanitizeGuid(episode.guid)
  return c.json({
    ...rest,
    showSlug: show?.slug ?? null,
    showTitle: show?.title ?? null,
    hasTranscript: !!transcript,
    audioCleanUrl: show ? `/audio/${show.slug}/${guid}/clean.mp3` : null,
    audioOriginalUrl: show ? `/audio/${show.slug}/${guid}/original.mp3` : null,
    ads: episodeAds,
  })
})

/** Full timestamped transcript: GET /api/episodes/:id/transcript */
episodesRoute.get('/episodes/:id/transcript', (c) => {
  const id = Number(c.req.param('id'))
  const row = db
    .select({ transcript: episodes.transcript })
    .from(episodes)
    .where(eq(episodes.id, id))
    .get()
  if (!row) return c.json({ error: 'not found' }, 404)
  if (!row.transcript) return c.json({ error: 'no transcript yet' }, 404)
  try {
    return c.json(TranscriptSchema.parse(JSON.parse(row.transcript)))
  } catch {
    return c.json({ error: 'transcript could not be parsed' }, 500)
  }
})

/** Start (or restart) the full pipeline for an episode. */
episodesRoute.post('/episodes/:id/process', (c) => {
  const id = Number(c.req.param('id'))
  const episode = db.select().from(episodes).where(eq(episodes.id, id)).get()
  if (!episode) return c.json({ error: 'not found' }, 404)
  queue.enqueue(id)
  return c.json({ ok: true, queued: id })
})

/** Re-run detection + cutting from the existing original + transcript. */
episodesRoute.post('/episodes/:id/reprocess', (c) => {
  const id = Number(c.req.param('id'))
  const episode = db.select().from(episodes).where(eq(episodes.id, id)).get()
  if (!episode) return c.json({ error: 'not found' }, 404)
  reprocessEpisode(id)
  return c.json({ ok: true, queued: id })
})
