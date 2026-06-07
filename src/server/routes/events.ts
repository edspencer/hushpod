import { Hono } from 'hono'
import { desc, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { events, episodes, shows } from '../db/schema.js'

export const eventsRoute = new Hono()

/** Recent activity across the whole pipeline: GET /api/events?limit=50
 * The persisted companion to the live dashboard queue. */
eventsRoute.get('/events', (c) => {
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50))
  const rows = db
    .select({
      id: events.id,
      type: events.type,
      at: events.at,
      durationMs: events.durationMs,
      data: events.data,
      episodeId: events.episodeId,
      showId: events.showId,
      episodeTitle: episodes.title,
      showTitle: shows.title,
      showSlug: shows.slug,
    })
    .from(events)
    .leftJoin(episodes, eq(events.episodeId, episodes.id))
    .leftJoin(shows, eq(events.showId, shows.id))
    .orderBy(desc(events.at))
    .limit(limit)
    .all()
  return c.json(rows.map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : null })))
})
