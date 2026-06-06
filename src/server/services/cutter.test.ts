import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeKeepRanges, normalizeCuts } from './cutter.js'

test('computeKeepRanges: complement of two ads', () => {
  const keep = computeKeepRanges(30, [
    { start: 5, end: 10 },
    { start: 20, end: 25 },
  ])
  assert.deepEqual(keep, [
    { start: 0, end: 5 },
    { start: 10, end: 20 },
    { start: 25, end: 30 },
  ])
})

test('computeKeepRanges: no ads keeps the whole episode', () => {
  assert.deepEqual(computeKeepRanges(30, []), [{ start: 0, end: 30 }])
})

test('computeKeepRanges: ad at the very start', () => {
  assert.deepEqual(computeKeepRanges(30, [{ start: 0, end: 10 }]), [{ start: 10, end: 30 }])
})

test('computeKeepRanges: ad at the very end leaves no trailing keep', () => {
  assert.deepEqual(computeKeepRanges(30, [{ start: 20, end: 30 }]), [{ start: 0, end: 20 }])
})

test('normalizeCuts: merges cuts within the 1s gap threshold', () => {
  const merged = normalizeCuts(
    [
      { start: 5, end: 10 },
      { start: 10.5, end: 12 },
    ],
    30,
  )
  assert.deepEqual(merged, [{ start: 5, end: 12 }])
})

test('normalizeCuts: does not merge cuts beyond the gap threshold', () => {
  const merged = normalizeCuts(
    [
      { start: 5, end: 10 },
      { start: 12, end: 14 },
    ],
    30,
  )
  assert.equal(merged.length, 2)
})

test('normalizeCuts: clamps to [0, duration] and drops slivers', () => {
  const merged = normalizeCuts(
    [
      { start: -5, end: 3 },
      { start: 28, end: 999 },
      { start: 15, end: 15.02 }, // < 0.05s sliver, dropped
    ],
    30,
  )
  assert.deepEqual(merged, [
    { start: 0, end: 3 },
    { start: 28, end: 30 },
  ])
})

test('computeKeepRanges: overlapping ads merge then complement', () => {
  const keep = computeKeepRanges(30, [
    { start: 5, end: 12 },
    { start: 10, end: 18 },
  ])
  assert.deepEqual(keep, [
    { start: 0, end: 5 },
    { start: 18, end: 30 },
  ])
})
