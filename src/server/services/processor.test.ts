import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickStage } from './processor.js'

test('pickStage: no audio yet → download', () => {
  assert.equal(pickStage(false, false), 'download')
  assert.equal(pickStage(false, true), 'download') // re-download if original is gone
})

test('pickStage: audio but no transcript → transcribe', () => {
  assert.equal(pickStage(true, false), 'transcribe')
})

test('pickStage: audio + transcript → detect (reprocess path)', () => {
  assert.equal(pickStage(true, true), 'detect')
})
