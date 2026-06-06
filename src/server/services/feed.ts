import Parser from 'rss-parser'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { shows, episodes, type Show } from '../db/schema.js'
import { slugify, uniqueSlug } from '../lib/text.js'
import { logger } from '../lib/logger.js'

const log = logger('feed')

const USER_AGENT = 'HushPod/0.1 (+https://github.com/hushpod)'

type CustomItem = {
  itunesDuration?: string
  itunesImage?: { href?: string }
}

const parser: Parser<unknown, CustomItem> = new Parser({
  customFields: {
    item: [
      ['itunes:duration', 'itunesDuration'],
      ['itunes:image', 'itunesImage'],
    ],
  },
})

/** Fetch a feed URL with a browser-ish UA and parse it. fetch follows redirects. */
async function fetchAndParse(feedUrl: string) {
  const res = await fetch(feedUrl, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`feed fetch failed (${res.status}) for ${feedUrl}`)
  const xml = await res.text()
  return parser.parseString(xml)
}

/** Derive a stable per-show episode identity. Prefer the RSS <guid>; the
 * enclosure URL is unreliable (CDNs inject per-request tracking params). */
function episodeGuid(item: { guid?: string; id?: string; link?: string; enclosure?: { url?: string } }): string | null {
  return item.guid ?? item.id ?? item.link ?? item.enclosure?.url ?? null
}

/** Parse an itunes:duration ("HH:MM:SS", "MM:SS", or seconds) into seconds. */
function parseDuration(d?: string): number | null {
  if (!d) return null
  if (/^\d+$/.test(d)) return Number.parseInt(d, 10)
  const parts = d.split(':').map((p) => Number.parseInt(p, 10))
  if (parts.some((n) => Number.isNaN(n))) return null
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

/** Subscribe to a new feed: create the show row. Does not fetch episodes yet. */
export async function subscribeToFeed(feedUrl: string): Promise<Show> {
  const existing = db.select().from(shows).where(eq(shows.feedUrl, feedUrl)).get()
  if (existing) throw new Error('Already subscribed to this feed')

  const feed = await fetchAndParse(feedUrl)
  const title = feed.title?.trim() || feedUrl
  const base = slugify(title)
  const slug = uniqueSlug(base, (s) => !!db.select({ id: shows.id }).from(shows).where(eq(shows.slug, s)).get())

  const show = db
    .insert(shows)
    .values({
      title,
      feedUrl,
      slug,
      description: feed.description ?? null,
      imageUrl: feed.image?.url ?? (feed as { itunes?: { image?: string } }).itunes?.image ?? null,
    })
    .returning()
    .get()

  log.info(`subscribed to "${title}" (slug=${slug}, id=${show.id})`)
  return show
}

export interface DiscoverResult {
  show: Show
  discovered: number
}

/**
 * Fetch a show's feed, insert any new episodes (matched by guid) as `pending`,
 * limited to the show's episodeLimit most recent items. Returns count inserted.
 */
export async function checkShow(show: Show): Promise<DiscoverResult> {
  const feed = await fetchAndParse(show.feedUrl)
  const items = (feed.items ?? []).slice(0, show.episodeLimit)

  const candidates = items
    .map((item) => {
      const guid = episodeGuid(item)
      const sourceUrl = item.enclosure?.url
      if (!guid || !sourceUrl) return null
      return {
        guid,
        sourceUrl,
        title: item.title?.trim() || 'Untitled',
        description: item.contentSnippet ?? item.content ?? null,
        publishedAt: item.isoDate ? new Date(item.isoDate) : null,
        duration: parseDuration(item.itunesDuration),
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  let discovered = 0
  if (candidates.length > 0) {
    const guids = candidates.map((c) => c.guid)
    const existing = new Set(
      db
        .select({ guid: episodes.guid })
        .from(episodes)
        .where(and(eq(episodes.showId, show.id), inArray(episodes.guid, guids)))
        .all()
        .map((r) => r.guid),
    )
    const fresh = candidates.filter((c) => !existing.has(c.guid))
    if (fresh.length > 0) {
      db.insert(episodes)
        .values(fresh.map((c) => ({ showId: show.id, status: 'pending' as const, ...c })))
        .run()
      discovered = fresh.length
    }
  }

  const updated = db
    .update(shows)
    .set({ lastCheckedAt: new Date(), updatedAt: new Date() })
    .where(eq(shows.id, show.id))
    .returning()
    .get()

  log.info(`checked "${show.title}": ${discovered} new episode(s)`)
  return { show: updated, discovered }
}

/** Check all active shows (called on the feed-check timer). */
export async function checkAllShows(): Promise<void> {
  const active = db.select().from(shows).where(eq(shows.isActive, true)).all()
  for (const show of active) {
    try {
      await checkShow(show)
    } catch (err) {
      log.error(`check failed for "${show.title}": ${(err as Error).message}`)
    }
  }
}
