import { Hono } from 'hono'
import { eq, sql, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { ads } from '../db/schema.js'

export const adsRoute = new Hono()

/** GET /api/episodes/:episodeId/ads */
adsRoute.get('/episodes/:episodeId/ads', (c) => {
  const episodeId = Number(c.req.param('episodeId'))
  const rows = db
    .select()
    .from(ads)
    .where(eq(ads.episodeId, episodeId))
    .orderBy(ads.startTime)
    .all()
  return c.json(rows)
})

/** GET /api/shows/:showId/ads */
adsRoute.get('/shows/:showId/ads', (c) => {
  const showId = Number(c.req.param('showId'))
  const rows = db
    .select()
    .from(ads)
    .where(eq(ads.showId, showId))
    .orderBy(desc(ads.createdAt))
    .all()
  return c.json(rows)
})

/** GET /api/ads/stats — aggregate counts and removed time. */
adsRoute.get('/ads/stats', (c) => {
  const totals = db
    .select({
      totalAds: sql<number>`count(*)`,
      totalSeconds: sql<number>`coalesce(sum(${ads.endTime} - ${ads.startTime}), 0)`,
    })
    .from(ads)
    .get()

  const byCompany = db
    .select({
      company: ads.company,
      count: sql<number>`count(*)`,
      seconds: sql<number>`coalesce(sum(${ads.endTime} - ${ads.startTime}), 0)`,
    })
    .from(ads)
    .groupBy(ads.company)
    .orderBy(sql`count(*) desc`)
    .all()

  const byLabel = db
    .select({ label: ads.label, count: sql<number>`count(*)` })
    .from(ads)
    .groupBy(ads.label)
    .all()

  return c.json({ ...totals, byCompany, byLabel })
})
