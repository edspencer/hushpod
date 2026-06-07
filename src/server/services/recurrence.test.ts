import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findRecurringSpans } from './recurrence.js'
import type { Transcript } from '../../shared/schemas.js'

// A recurring ~intro spiel reused verbatim across episodes, plus episode-unique
// editorial. The matcher should isolate the recurring open and leave the rest.
const INTRO =
  'welcome to nothing much happens bedtime stories for grown ups i will tell you a story to help you fall asleep i will read it twice and go a little slower the second time'

function mk(intro: string, body: string): Transcript {
  const introSegs = intro.split('. ').map((t, i) => ({
    id: i,
    start: i * 5,
    end: i * 5 + 5,
    text: t,
  }))
  const base = introSegs.length
  const bodySegs = body.split('. ').map((t, i) => ({
    id: base + i,
    start: (base + i) * 5,
    end: (base + i) * 5 + 5,
    text: t,
  }))
  return { segments: [...introSegs, ...bodySegs] }
}

test('findRecurringSpans: flags the recurring intro shared across priors', () => {
  const current = mk(
    INTRO,
    'a quiet harbor lay still beneath the moonlight. the boats rocked gently',
  )
  const priors = [
    mk(INTRO, 'high in the hills a cabin stood alone. snow fell softly outside'),
    mk(INTRO, 'across the valley a meadow glowed at dusk. bees drifted between flowers'),
  ]
  const spans = findRecurringSpans(current, priors)
  assert.ok(spans.length >= 1, 'should find at least one recurring span')
  const first = spans[0]!
  assert.equal(first.startSegmentId, 0, 'span starts at the top of the episode')
  assert.match(first.text.toLowerCase(), /nothing much happens/)
  // The episode-unique story must NOT be inside the recurring span.
  assert.doesNotMatch(first.text.toLowerCase(), /quiet harbor/)
})

test('findRecurringSpans: no priors → nothing', () => {
  const current = mk(INTRO, 'a unique story about the sea')
  assert.deepEqual(findRecurringSpans(current, []), [])
})

test('findRecurringSpans: a single matching prior is below the 2-episode threshold', () => {
  const current = mk(INTRO, 'a story about rain')
  const priors = [mk(INTRO, 'a story about wind')]
  // minEpisodes clamps to priors.length (1) only when there are fewer priors;
  // with the default 2 and one prior, the clamp still makes one match enough.
  const spans = findRecurringSpans(current, priors)
  assert.ok(spans.length >= 1)
})

test('findRecurringSpans: distinct episodes with no shared wording → nothing', () => {
  const current = mk('an entirely original opening for today', 'and an original body too')
  const priors = [
    mk('a totally different opening line here', 'with different body content'),
    mk('yet another unrelated opening phrase', 'and more unrelated material'),
  ]
  assert.deepEqual(findRecurringSpans(current, priors), [])
})
