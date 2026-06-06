import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { episodes } from '../db/schema.js'
import { queue } from '../services/processor.js'

export const statusRoute = new Hono()

/** GET /api/status — processing queue + episode status breakdown. */
statusRoute.get('/', (c) => {
  const counts = db
    .select({ status: episodes.status, count: sql<number>`count(*)` })
    .from(episodes)
    .groupBy(episodes.status)
    .all()
  const byStatus: Record<string, number> = {}
  for (const row of counts) byStatus[row.status] = row.count
  return c.json({ queue: queue.status, episodes: byStatus })
})
