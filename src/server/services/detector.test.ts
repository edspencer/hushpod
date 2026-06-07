import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractJson, mergeOverlaps, mapDetectionsToAds } from './detector.js'
import type { DetectedSegment, TranscriptSegment } from '../../shared/schemas.js'

const segs: TranscriptSegment[] = [
  { id: 0, start: 0, end: 5, text: 'Welcome to the show.' },
  { id: 1, start: 5, end: 10, text: 'This episode is sponsored by Acme.' },
  { id: 2, start: 10, end: 15, text: 'Acme makes great widgets.' },
  { id: 3, start: 15, end: 20, text: 'Back to the content.' },
]

test('extractJson: plain object', () => {
  assert.deepEqual(extractJson('{"segments":[]}'), { segments: [] })
})

test('extractJson: ignores prose and markdown fences', () => {
  const text =
    'Sure! Here is the JSON:\n```json\n{"segments":[{"startSegmentId":1}]}\n```\nHope that helps.'
  assert.deepEqual(extractJson(text), { segments: [{ startSegmentId: 1 }] })
})

test('extractJson: handles braces inside strings', () => {
  const out = extractJson('{"reason":"buy now {limited}"}') as { reason: string }
  assert.equal(out.reason, 'buy now {limited}')
})

test('extractJson: throws on no object', () => {
  assert.throws(() => extractJson('no json here'))
})

test('mergeOverlaps: merges overlapping and adjacent id ranges', () => {
  const input: DetectedSegment[] = [
    { startSegmentId: 1, endSegmentId: 2, label: 'ad', company: null, reason: 'a' },
    { startSegmentId: 2, endSegmentId: 3, label: 'ad', company: 'Acme', reason: 'b' },
  ]
  const merged = mergeOverlaps(input)
  assert.equal(merged.length, 1)
  assert.equal(merged[0]!.startSegmentId, 1)
  assert.equal(merged[0]!.endSegmentId, 3)
  assert.equal(merged[0]!.company, 'Acme') // null filled from the second
})

test('mergeOverlaps: keeps disjoint ranges separate', () => {
  const input: DetectedSegment[] = [
    { startSegmentId: 0, endSegmentId: 0, label: 'intro', company: null, reason: 'a' },
    { startSegmentId: 3, endSegmentId: 3, label: 'outro', company: null, reason: 'b' },
  ]
  assert.equal(mergeOverlaps(input).length, 2)
})

test('mapDetectionsToAds: maps ids to exact times and joins text', () => {
  const detected: DetectedSegment[] = [
    { startSegmentId: 1, endSegmentId: 2, label: 'ad', company: 'Acme', reason: 'sponsor read' },
  ]
  const ads = mapDetectionsToAds(detected, segs)
  assert.equal(ads.length, 1)
  assert.equal(ads[0]!.startTime, 5)
  assert.equal(ads[0]!.endTime, 15)
  assert.equal(ads[0]!.adText, 'This episode is sponsored by Acme. Acme makes great widgets.')
})

test('mapDetectionsToAds: drops out-of-range ids', () => {
  const detected: DetectedSegment[] = [
    { startSegmentId: 99, endSegmentId: 100, label: 'ad', company: null, reason: 'hallucinated' },
  ]
  assert.equal(mapDetectionsToAds(detected, segs).length, 0)
})

test('mapDetectionsToAds: normalizes reversed id order', () => {
  const detected: DetectedSegment[] = [
    { startSegmentId: 2, endSegmentId: 1, label: 'ad', company: null, reason: 'reversed' },
  ]
  const ads = mapDetectionsToAds(detected, segs)
  assert.equal(ads[0]!.startTime, 5)
  assert.equal(ads[0]!.endTime, 15)
})
