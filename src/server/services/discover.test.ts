import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractAppleId, looksLikeXml, findFeedLinkInHtml } from './discover.js'

test('extractAppleId: Apple Podcasts URL', () => {
  const url = new URL('https://podcasts.apple.com/us/podcast/up-first/id1222114325')
  assert.equal(extractAppleId(url), '1222114325')
})

test('extractAppleId: with episode query param', () => {
  const url = new URL('https://podcasts.apple.com/us/podcast/x/id1222114325?i=1000654321')
  assert.equal(extractAppleId(url), '1222114325')
})

test('extractAppleId: non-Apple host returns null', () => {
  assert.equal(extractAppleId(new URL('https://example.com/id123')), null)
})

test('looksLikeXml: by content-type', () => {
  assert.equal(looksLikeXml('application/rss+xml; charset=utf-8', ''), true)
  assert.equal(looksLikeXml('text/xml', ''), true)
})

test('looksLikeXml: by body sniff', () => {
  assert.equal(looksLikeXml('text/plain', '<?xml version="1.0"?><rss>'), true)
  assert.equal(looksLikeXml('text/html', '<!doctype html><html>'), false)
})

test('findFeedLinkInHtml: prefers rss, resolves relative href', () => {
  const html = `<head>
    <link rel="alternate" type="application/atom+xml" href="/atom.xml">
    <link rel="alternate" type="application/rss+xml" href="/feed.xml">
  </head>`
  assert.equal(findFeedLinkInHtml(html, 'https://example.com/show'), 'https://example.com/feed.xml')
})

test('findFeedLinkInHtml: falls back to atom', () => {
  const html = `<link rel="alternate" type="application/atom+xml" href="https://x.com/a.xml">`
  assert.equal(findFeedLinkInHtml(html, 'https://x.com'), 'https://x.com/a.xml')
})

test('findFeedLinkInHtml: none present', () => {
  assert.equal(findFeedLinkInHtml('<html><body>no feed</body></html>', 'https://x.com'), null)
})
