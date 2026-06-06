import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { eq, and, desc, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { shows, episodes } from '../db/schema.js'
import { CreateShowSchema, UpdateShowSchema } from '../../shared/schemas.js'
import { subscribeToFeed, checkShow } from '../services/feed.js'
import { queue } from '../services/processor.js'
import { SHOWS_DIR } from '../lib/config.js'
import { logger } from '../lib/logger.js'

const log = logger('routes/shows')

export const showsRoute = new Hono()

/** Enqueue all pending episodes for a show. */
function enqueueShowPending(showId: number): void {
  const ids = db
    .select({ id: episodes.id })
    .from(episodes)
    .where(and(eq(episodes.showId, showId), eq(episodes.status, 'pending')))
    .all()
  for (const { id } of ids) queue.enqueue(id)
}

showsRoute.get('/', (c) => {
  const rows = db.select().from(shows).orderBy(desc(shows.createdAt)).all()
  // Count episodes per show with a grouped query. (A correlated subquery via
  // `${shows.id}` renders the column unqualified as "id", which SQLite binds to
  // episodes.id — a silent footgun — so we avoid it.)
  const counts = db
    .select({ showId: episodes.showId, count: sql<number>`count(*)` })
    .from(episodes)
    .groupBy(episodes.showId)
    .all()
  const countMap = new Map(counts.map((r) => [r.showId, r.count]))
  return c.json(rows.map((s) => ({ ...s, episodeCount: countMap.get(s.id) ?? 0 })))
})

showsRoute.post('/', zValidator('json', CreateShowSchema), async (c) => {
  const { feedUrl } = c.req.valid('json')
  try {
    const show = await subscribeToFeed(feedUrl)
    const { discovered } = await checkShow(show)
    enqueueShowPending(show.id)
    return c.json({ show, discovered }, 201)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

showsRoute.get('/:id', (c) => {
  const id = Number(c.req.param('id'))
  const show = db.select().from(shows).where(eq(shows.id, id)).get()
  if (!show) return c.json({ error: 'not found' }, 404)
  const eps = db
    .select()
    .from(episodes)
    .where(eq(episodes.showId, id))
    .orderBy(desc(episodes.publishedAt))
    .all()
  return c.json({ ...show, episodes: eps })
})

showsRoute.patch('/:id', zValidator('json', UpdateShowSchema), (c) => {
  const id = Number(c.req.param('id'))
  const patch = c.req.valid('json')
  const updated = db
    .update(shows)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(shows.id, id))
    .returning()
    .get()
  if (!updated) return c.json({ error: 'not found' }, 404)
  return c.json(updated)
})

/** Manually trigger a feed check (discover new episodes and enqueue them). */
showsRoute.post('/:id/check', async (c) => {
  const id = Number(c.req.param('id'))
  const show = db.select().from(shows).where(eq(shows.id, id)).get()
  if (!show) return c.json({ error: 'not found' }, 404)
  const { discovered } = await checkShow(show)
  enqueueShowPending(id)
  return c.json({ discovered })
})

showsRoute.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const deleteFiles = c.req.query('deleteFiles') === 'true'
  const show = db.select().from(shows).where(eq(shows.id, id)).get()
  if (!show) return c.json({ error: 'not found' }, 404)
  db.delete(shows).where(eq(shows.id, id)).run() // cascades to episodes + ads
  if (deleteFiles) {
    await rm(join(SHOWS_DIR, show.slug), { recursive: true, force: true }).catch((e) =>
      log.warn(`failed to delete files for ${show.slug}: ${(e as Error).message}`),
    )
  }
  return c.json({ ok: true })
})
