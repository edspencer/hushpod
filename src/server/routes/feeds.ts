import { Hono, type Context } from 'hono'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { eq, and, desc, isNotNull } from 'drizzle-orm'
import { db } from '../db/index.js'
import { shows, episodes, type Show, type Episode } from '../db/schema.js'
import { SHOWS_DIR, sanitizeGuid } from '../lib/config.js'
import { getSetting } from '../lib/settings.js'
import { buildShowFeed, buildAllFeed } from '../lib/rss.js'

export const feedsRoute = new Hono()

const XML_HEADERS = { 'Content-Type': 'application/rss+xml; charset=utf-8' }

/** Done episodes (have a clean file) for a show, newest first. */
function doneEpisodes(showId: number): Episode[] {
  return db
    .select()
    .from(episodes)
    .where(and(eq(episodes.showId, showId), eq(episodes.status, 'done'), isNotNull(episodes.cleanPath)))
    .orderBy(desc(episodes.publishedAt))
    .all()
}

feedsRoute.get('/feed/all', (c) => {
  const baseUrl = getSetting('baseUrl')
  const rows = db
    .select()
    .from(episodes)
    .innerJoin(shows, eq(episodes.showId, shows.id))
    .where(and(eq(episodes.status, 'done'), isNotNull(episodes.cleanPath)))
    .orderBy(desc(episodes.publishedAt))
    .limit(200)
    .all()
  const items = rows.map((r) => ({ show: r.shows as Show, ep: r.episodes as Episode }))
  return c.body(buildAllFeed(baseUrl, items), 200, XML_HEADERS)
})

feedsRoute.get('/feed/:slug', (c) => {
  const slug = c.req.param('slug')
  const show = db.select().from(shows).where(eq(shows.slug, slug)).get()
  if (!show) return c.json({ error: 'not found' }, 404)
  const baseUrl = getSetting('baseUrl')
  return c.body(buildShowFeed(baseUrl, show, doneEpisodes(show.id)), 200, XML_HEADERS)
})

/** Serve a file with HTTP Range support (206) — required by podcast players. */
async function serveAudio(c: Context, absPath: string) {
  let size: number
  try {
    size = (await stat(absPath)).size
  } catch {
    return c.json({ error: 'audio not found' }, 404)
  }

  const range = c.req.header('range')
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'audio/mpeg',
    'Accept-Ranges': 'bytes',
  }

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    if (m) {
      const start = m[1] ? Number.parseInt(m[1], 10) : 0
      const end = m[2] ? Number.parseInt(m[2], 10) : size - 1
      if (start >= size || end >= size || start > end) {
        return c.body(null, 416, { 'Content-Range': `bytes */${size}` })
      }
      const stream = Readable.toWeb(createReadStream(absPath, { start, end })) as ReadableStream
      return c.body(stream, 206, {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(end - start + 1),
      })
    }
  }

  const stream = Readable.toWeb(createReadStream(absPath)) as ReadableStream
  return c.body(stream, 200, { ...baseHeaders, 'Content-Length': String(size) })
}

feedsRoute.get('/audio/:slug/:guid/:file', (c) => {
  const slug = sanitizeGuid(c.req.param('slug'))
  const guid = sanitizeGuid(c.req.param('guid'))
  const file = c.req.param('file')
  if (file !== 'clean.mp3' && file !== 'original.mp3') return c.json({ error: 'not found' }, 404)
  const absPath = join(SHOWS_DIR, slug, guid, file)
  return serveAudio(c, absPath)
})
