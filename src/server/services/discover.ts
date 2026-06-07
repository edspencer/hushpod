import { logger } from '../lib/logger.js'

const log = logger('discover')

const USER_AGENT = 'HushPod/0.1 (+https://github.com/edspencer/hushpod)'
const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup'

/** Extract an Apple/iTunes collection id from a Podcasts URL (…/id1222114325). */
export function extractAppleId(url: URL): string | null {
  if (!/(^|\.)apple\.com$/i.test(url.hostname)) return null
  const m = url.pathname.match(/\/id(\d+)/) ?? url.href.match(/[?&]id=(\d+)/)
  return m ? m[1]! : null
}

/** Heuristic: does this response look like an RSS/Atom feed rather than HTML? */
export function looksLikeXml(contentType: string, body: string): boolean {
  if (/(application|text)\/(rss\+xml|atom\+xml|xml)/i.test(contentType)) return true
  const head = body.slice(0, 1000).trimStart().toLowerCase()
  return (
    head.startsWith('<?xml') ||
    head.startsWith('<rss') ||
    head.startsWith('<feed') ||
    head.includes('<rss')
  )
}

/**
 * Find a feed URL advertised in an HTML page via
 * <link rel="alternate" type="application/rss+xml" href="…">. RSS is preferred
 * over Atom. Relative hrefs are resolved against the page URL.
 */
export function findFeedLinkInHtml(html: string, baseUrl: string): string | null {
  const tags = html.match(/<link\b[^>]*>/gi) ?? []
  const candidates = tags.filter((t) => /rel=["']?alternate["']?/i.test(t))
  const href = (tag: string) => tag.match(/href=["']([^"']+)["']/i)?.[1]

  const pick = (re: RegExp) => {
    for (const tag of candidates) {
      if (re.test(tag)) {
        const h = href(tag)
        if (h) {
          try {
            return new URL(h, baseUrl).toString()
          } catch {
            /* ignore malformed href */
          }
        }
      }
    }
    return null
  }

  return pick(/type=["']application\/rss\+xml["']/i) ?? pick(/type=["']application\/atom\+xml["']/i)
}

async function lookupItunes(id: string): Promise<string> {
  const res = await fetch(`${ITUNES_LOOKUP}?id=${id}&entity=podcast`, {
    headers: { 'User-Agent': USER_AGENT },
  })
  if (!res.ok) throw new Error(`Apple Podcasts lookup failed (${res.status})`)
  const json = (await res.json()) as { results?: Array<{ feedUrl?: string }> }
  const feedUrl = json.results?.[0]?.feedUrl
  if (!feedUrl) throw new Error('No feed is published for that Apple Podcasts show')
  return feedUrl
}

/**
 * Turn whatever the user pasted into an actual RSS feed URL. Accepts:
 *  - a raw RSS/Atom feed URL (returned as-is once confirmed to be a feed)
 *  - an Apple Podcasts URL or a bare iTunes collection id (resolved via lookup)
 *  - a show's website/landing URL (feed discovered from its <link> tags)
 */
export async function resolveFeedUrl(input: string): Promise<string> {
  const raw = input.trim()
  if (!raw) throw new Error('Enter a feed URL or Apple Podcasts link')

  // Bare iTunes collection id, e.g. "1222114325".
  if (/^\d{5,}$/.test(raw)) return lookupItunes(raw)

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error("That doesn't look like a URL or an Apple Podcasts id")
  }

  // Apple Podcasts / iTunes page → resolve via the lookup API.
  const appleId = extractAppleId(url)
  if (appleId) {
    log.info(`resolving Apple Podcasts id ${appleId}`)
    return lookupItunes(appleId)
  }

  // Otherwise fetch it and decide: already a feed, or an HTML page to scrape.
  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`Couldn't fetch that URL (${res.status})`)
  const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
  const body = await res.text()
  const finalUrl = res.url || url.toString()

  if (looksLikeXml(contentType, body)) return finalUrl

  const discovered = findFeedLinkInHtml(body, finalUrl)
  if (discovered) {
    log.info(`discovered feed link in page: ${discovered}`)
    return discovered
  }

  throw new Error(
    "Couldn't find a podcast feed there. Paste the RSS feed URL or an Apple Podcasts link.",
  )
}
