import { sanitizeGuid } from './config.js'
import type { Show, Episode } from '../db/schema.js'

/** XML-escape text content. */
function xml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Wrap free text (descriptions) in CDATA, neutralizing any embedded ]]>. */
function cdata(s: string): string {
  return `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`
}

function rfc2822(d: Date | null): string {
  return (d ?? new Date(0)).toUTCString()
}

/** Public URL for an episode's clean audio. This format is a permanent contract
 * with subscribers' apps — do not change it once shipped. */
export function cleanAudioUrl(baseUrl: string, slug: string, guid: string): string {
  return `${baseUrl.replace(/\/$/, '')}/audio/${slug}/${sanitizeGuid(guid)}/clean.mp3`
}

function renderItem(baseUrl: string, show: Show, ep: Episode): string {
  const url = cleanAudioUrl(baseUrl, show.slug, ep.guid)
  const len = ep.cleanSize ?? 0
  const parts = [
    '    <item>',
    `      <title>${xml(ep.title)}</title>`,
    ep.description ? `      <description>${cdata(ep.description)}</description>` : '',
    `      <guid isPermaLink="false">${xml(ep.guid)}</guid>`,
    `      <pubDate>${rfc2822(ep.publishedAt)}</pubDate>`,
    `      <enclosure url="${xml(url)}" length="${len}" type="audio/mpeg" />`,
    ep.duration ? `      <itunes:duration>${Math.round(ep.duration)}</itunes:duration>` : '',
    '    </item>',
  ]
  return parts.filter(Boolean).join('\n')
}

interface FeedInput {
  title: string
  description: string
  link: string
  imageUrl: string | null
}

/** Build a complete RSS 2.0 feed (with the iTunes namespace) for the given
 * show/episode pairs. Only episodes with a clean file should be passed in. */
function renderFeed(
  baseUrl: string,
  feed: FeedInput,
  items: Array<{ show: Show; ep: Episode }>,
): string {
  const image = feed.imageUrl
    ? `    <image><url>${xml(feed.imageUrl)}</url><title>${xml(feed.title)}</title><link>${xml(feed.link)}</link></image>\n    <itunes:image href="${xml(feed.imageUrl)}" />`
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${xml(feed.title)}</title>
    <link>${xml(feed.link)}</link>
    <description>${cdata(feed.description)}</description>
    <generator>HushPod</generator>
    <itunes:author>${xml(feed.title)}</itunes:author>
${image}
${items.map(({ show, ep }) => renderItem(baseUrl, show, ep)).join('\n')}
  </channel>
</rss>`
}

/** Clean feed for a single show. */
export function buildShowFeed(baseUrl: string, show: Show, episodes: Episode[]): string {
  return renderFeed(
    baseUrl,
    {
      title: `${show.title} (HushPod)`,
      description: show.description ?? `Ad-free version of ${show.title}, processed by HushPod.`,
      link: `${baseUrl.replace(/\/$/, '')}/feed/${show.slug}`,
      imageUrl: show.imageUrl,
    },
    episodes.map((ep) => ({ show, ep })),
  )
}

/** Unified clean feed across all shows. */
export function buildAllFeed(baseUrl: string, items: Array<{ show: Show; ep: Episode }>): string {
  return renderFeed(
    baseUrl,
    {
      title: 'HushPod — All Shows',
      description: 'Combined ad-free feed of all shows processed by HushPod.',
      link: `${baseUrl.replace(/\/$/, '')}/feed/all`,
      imageUrl: null,
    },
    items,
  )
}
