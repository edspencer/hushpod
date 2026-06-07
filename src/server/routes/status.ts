import { Hono } from 'hono'
import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { episodes, shows } from '../db/schema.js'
import { queueSnapshot } from '../services/processor.js'

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

  // Resolve the pipeline snapshot to titles for the dashboard's queue table.
  // Each entry carries its stage + state so a downloaded episode waiting for the
  // GPU reads as "queued for transcribe", not an indistinct "pending".
  const snap = queueSnapshot()
  let items: unknown[] = []
  if (snap.length > 0) {
    const ids = snap.map((s) => s.id)
    const rows = db
      .select({
        id: episodes.id,
        status: episodes.status,
        title: episodes.title,
        showId: shows.id,
        showTitle: shows.title,
        showSlug: shows.slug,
      })
      .from(episodes)
      .innerJoin(shows, eq(episodes.showId, shows.id))
      .where(inArray(episodes.id, ids))
      .all()
    const byId = new Map(rows.map((r) => [r.id, r]))
    items = snap
      .map((s) => {
        const row = byId.get(s.id)
        return row ? { ...row, stage: s.stage, state: s.state } : null
      })
      .filter((r): r is NonNullable<typeof r> => r != null)
  }

  const active = snap.filter((s) => s.state === 'active').map((s) => s.id)
  const queued = snap.filter((s) => s.state === 'queued').map((s) => s.id)
  return c.json({ queue: { active, queued, items }, episodes: byStatus })
})
