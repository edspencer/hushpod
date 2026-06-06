import { Hono, type Context } from 'hono'
import { createReadStream } from 'node:fs'
import { stat, readdir } from 'node:fs/promises'
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

/** Weak ETag derived from episode count + newest mtime, so we can answer 304
 * to conditional requests without re-serializing the feed body. */
function feedEtag(eps: Episode[]): string {
  let newest = 0
  for (const e of eps) {
    const t = e.updatedAt ? new Date(e.updatedAt).getTime() : 0
    if (t > newest) newest = t
  }
  return `W/"${eps.length}-${newest}"`
}

/** If the client's If-None-Match matches, send 304; otherwise serve the body
 * with ETag + Last-Modified headers set. */
function serveFeed(c: Context, eps: Episode[], body: string) {
  const etag = feedEtag(eps)
  if (c.req.header('if-none-match') === etag) return c.body(null, 304, { ETag: etag })
  let newest = 0
  for (const e of eps) {
    const t = e.updatedAt ? new Date(e.updatedAt).getTime() : 0
    if (t > newest) newest = t
  }
  return c.body(body, 200, {
    ...XML_HEADERS,
    ETag: etag,
    ...(newest > 0 ? { 'Last-Modified': new Date(newest).toUTCString() } : {}),
  })
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
  return serveFeed(c, items.map((i) => i.ep), buildAllFeed(baseUrl, items))
})

feedsRoute.get('/feed/:slug', (c) => {
  const slug = c.req.param('slug')
  const show = db.select().from(shows).where(eq(shows.slug, slug)).get()
  if (!show) return c.json({ error: 'not found' }, 404)
  const baseUrl = getSetting('baseUrl')
  const eps = doneEpisodes(show.id)
  return serveFeed(c, eps, buildShowFeed(baseUrl, show, eps))
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

feedsRoute.get('/audio/:slug/:guid/:file', async (c) => {
  const slug = sanitizeGuid(c.req.param('slug'))
  const guid = sanitizeGuid(c.req.param('guid'))
  const file = c.req.param('file')
  const dir = join(SHOWS_DIR, slug, guid)

  if (file === 'clean.mp3') return serveAudio(c, join(dir, 'clean.mp3'))

  // Original is kept under its real extension (original.mp3 / .m4a / ...).
  if (file.startsWith('original')) {
    const entry = await readdir(dir)
      .then((files) => files.find((f) => f.startsWith('original.')))
      .catch(() => undefined)
    if (!entry) return c.json({ error: 'not found' }, 404)
    return serveAudio(c, join(dir, entry))
  }
  return c.json({ error: 'not found' }, 404)
})
