import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractJson,
  mergeOverlaps,
  mapDetectionsToAds,
  addUncoveredFluff,
  reclassifyFluff,
  type DetectedAd,
} from './detector.js'
import type { DetectedSegment, TranscriptSegment } from '../../shared/schemas.js'

const fluff = (text: string): DetectedAd => ({
  startTime: 0,
  endTime: 30,
  label: 'fluff',
  company: null,
  adText: text,
  reason: 'recurs',
})

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
    { startSegmentId: 0, endSegmentId: 0, label: 'fluff', company: null, reason: 'a' },
    { startSegmentId: 3, endSegmentId: 3, label: 'ad', company: null, reason: 'b' },
  ]
  assert.equal(mergeOverlaps(input).length, 2)
})

test('addUncoveredFluff: adds recurring spans the LLM ignored as fluff', () => {
  const detected: DetectedSegment[] = [
    { startSegmentId: 10, endSegmentId: 12, label: 'ad', company: 'Acme', reason: 'x' },
  ]
  const recurring = [
    { startSegmentId: 0, endSegmentId: 3, text: 'recurring open' }, // untouched → added
    { startSegmentId: 11, endSegmentId: 14, text: 'overlaps the ad' }, // overlaps → skipped
  ]
  const out = addUncoveredFluff(detected, recurring)
  assert.equal(out.length, 2)
  const fluff = out.find((d) => d.label === 'fluff')!
  assert.equal(fluff.startSegmentId, 0)
  assert.equal(fluff.endSegmentId, 3)
})

test('reclassifyFluff: a sponsor read swept into fluff becomes an ad', () => {
  const out = reclassifyFluff(fluff('Stay with us. This message comes from Progressive Insurance.'))
  assert.equal(out.label, 'ad')
})

test('reclassifyFluff: a cross-promo swept into fluff becomes an ad', () => {
  const out = reclassifyFluff(
    fluff("Every episode of It's Been a Minute. Follow it wherever you get your podcasts."),
  )
  assert.equal(out.label, 'ad')
})

test('reclassifyFluff: a URL with a path marks an ad', () => {
  assert.equal(reclassifyFluff(fluff('Support for NPR. goodrx.com/upfirst')).label, 'ad')
})

test('reclassifyFluff: genuine scaffolding stays fluff', () => {
  assert.equal(
    reclassifyFluff(fluff("I'm Steve with A. Martinez, this is Up First.")).label,
    'fluff',
  )
  assert.equal(reclassifyFluff(fluff('Our director is Christopher Thomas.')).label, 'fluff')
})

test('reclassifyFluff: non-fluff labels pass through untouched', () => {
  const ad: DetectedAd = { ...fluff('this message comes from x'), label: 'ad' }
  assert.equal(reclassifyFluff(ad).label, 'ad')
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
