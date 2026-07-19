# hushpod

<!--
Maintained by Changesets (see "Releasing" in the README). New releases are added
directly under the heading above. Entries through 0.9.2 are a historical summary
reconstructed from the release commits that predate the Changesets workflow.
-->

## 0.9.2

### Patch Changes

- Tab the episode page (Overview | Stats) and enrich the pipeline stepper.
- Show the downloaded size under the Download step in the pipeline stepper.

## 0.9.1

### Patch Changes

- Add a top-level Stats page (metrics + queue + full activity feed).
- Accept (and drop) a "content" label so detection can't hard-fail on it.

## 0.9.0

### Minor Changes

- Deterministic per-sponsor ad-pod splitter; record the detection model/provider.
- Track detection token usage and estimated cost in episode telemetry.

## 0.8.0

### Minor Changes

- Wire up the Anthropic provider for ad detection.
- Detection overhaul: drop "promo", few-shot ad/fluff prompt, split ad pods.
- Pipeline parallelism + observability: stage queues, queue table, telemetry/event log.

### Patch Changes

- Fix the dashboard GPU hog and make local Whisper parallel-safe.

## 0.7.0

### Minor Changes

- Add a "fluff" label: detect recurring show scaffolding and cut it per show.

## 0.6.0

### Minor Changes

- Restructure the show page into tabs.

## 0.5.0

### Minor Changes

- Red/white/blue newspaper-editorial theme; serif long-form typography.

## 0.4.0

### Minor Changes

- Warm editorial reskin giving HushPod its own visual identity.

## 0.3.1

### Patch Changes

- Fix the light/dark theme toggle (add a light palette).
- Episode description: full width, clamp to 5 lines with "Show more".

## 0.3.0

### Minor Changes

- Show stats: content-vs-ads donut and stacked-area-over-time chart.
- Per-show detection guidance.

## 0.2.0

### Minor Changes

- Initial tagged release: end-to-end pipeline (subscribe → download → transcribe
  → detect → cut → serve clean RSS), React UI, CI + Docker publish, deployment docs.
