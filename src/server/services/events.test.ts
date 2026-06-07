import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foldTelemetry } from './events.js'
import type { Telemetry } from '../../shared/schemas.js'

const empty: Telemetry = { stages: {} }

test('foldTelemetry: discovered sets discoveredAt', () => {
  const t = foldTelemetry(empty, 'episode.discovered', 1000)
  assert.equal(t.discoveredAt, 1000)
})

test('foldTelemetry: stage started then finished records timing + facts', () => {
  let t = foldTelemetry(empty, 'transcribe.started', 1000)
  t = foldTelemetry(t, 'transcribe.finished', 9000, {
    durationMs: 8000,
    data: { segments: 712, model: 'base' },
  })
  assert.equal(t.stages.transcribe?.startedAt, 1000)
  assert.equal(t.stages.transcribe?.endedAt, 9000)
  assert.equal(t.stages.transcribe?.ms, 8000)
  assert.equal(t.stages.transcribe?.segments, 712)
  assert.equal(t.stages.transcribe?.model, 'base')
})

test('foldTelemetry: detect.started increments attempts', () => {
  let t = foldTelemetry(empty, 'detect.started', 1)
  assert.equal(t.attempts, 1)
  t = foldTelemetry(t, 'detect.started', 2) // a reprocess
  assert.equal(t.attempts, 2)
})

test('foldTelemetry: episode.done totals the stage durations', () => {
  let t = foldTelemetry(empty, 'download.finished', 100, { durationMs: 1000 })
  t = foldTelemetry(t, 'transcribe.finished', 200, { durationMs: 8000 })
  t = foldTelemetry(t, 'detect.finished', 300, { durationMs: 2000 })
  t = foldTelemetry(t, 'cut.finished', 400, { durationMs: 500 })
  t = foldTelemetry(t, 'episode.done', 500)
  assert.equal(t.totalMs, 1000 + 8000 + 2000 + 500)
  assert.equal(t.doneAt, 500)
})

test('foldTelemetry: error records lastError', () => {
  const t = foldTelemetry(empty, 'episode.error', 700, {
    data: { message: 'boom', stage: 'transcribe' },
  })
  assert.equal(t.lastError?.message, 'boom')
  assert.equal(t.lastError?.stage, 'transcribe')
})

test('foldTelemetry: is pure (does not mutate input)', () => {
  const before: Telemetry = { stages: {} }
  foldTelemetry(before, 'download.started', 1)
  assert.deepEqual(before, { stages: {} })
})
