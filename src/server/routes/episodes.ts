import { Hono } from 'hono'
import { eq, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { episodes, ads } from '../db/schema.js'
import { queue, reprocessEpisode } from '../services/processor.js'

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
  const episodeAds = db.select().from(ads).where(eq(ads.episodeId, id)).orderBy(ads.startTime).all()
  // Omit the (large) transcript from the detail payload by default.
  const { transcript, ...rest } = episode
  return c.json({ ...rest, hasTranscript: !!transcript, ads: episodeAds })
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
