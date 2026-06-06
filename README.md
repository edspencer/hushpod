# HushPod

Self-hosted podcast ad remover. Subscribes to RSS feeds, downloads episodes,
transcribes them, detects ads/promos/intros/outros with an LLM, cuts them out
with FFmpeg, and serves clean ad-free RSS feeds you can subscribe to from any
podcast app.

TypeScript end to end. See [`hushpod-spec.md`](./hushpod-spec.md) for the full
design and [`docs/prior-art-lessons.md`](./docs/prior-art-lessons.md) for
lessons distilled from prior art (MinusPod / Podly / AGPAR).

## Status

Walking skeleton — backend complete and proven end-to-end on real feeds for
everything except the two AI steps (which need your own infrastructure):

| Step | State |
|------|-------|
| Feed subscribe / parse / discovery | ✅ proven on real feeds |
| Download (CDN redirects, byte cap, content-type) | ✅ |
| Transcribe (local whisper.cpp / remote OpenAI-compatible) | ⏳ needs a model or endpoint |
| Ad detection (LLM, segment-id mapping + JSON repair) | ⏳ needs an LLM endpoint |
| Cut (FFmpeg, keep-range math, transition-sound detection) | ✅ proven on real audio |
| Clean RSS + Range audio serving | ✅ proven (206 Partial Content) |
| React UI | ⛔ not started |

## Requirements

- Node.js 22+ and pnpm
- FFmpeg + ffprobe on PATH
- An LLM endpoint (OpenAI-compatible: Ollama, LM Studio, vLLM, or a commercial API)
- Whisper: either local (`nodejs-whisper`, compiles whisper.cpp on first run) or
  a remote OpenAI-compatible `/v1/audio/transcriptions` endpoint

## Quick start

```sh
pnpm install
pnpm db:migrate          # apply schema
pnpm dev                 # start the server (http://localhost:3000)
```

Then configure your LLM + whisper endpoints (see below), subscribe to a show,
and the pipeline runs automatically.

### Configure the AI backends

`PATCH /api/settings` (or the Settings UI, once built). For a local
OpenAI-compatible stack pointed at a box on your network:

```sh
curl -X PATCH localhost:3000/api/settings -H 'content-type: application/json' -d '{
  "llmProvider": "openai-compatible",
  "llmBaseUrl": "http://YOUR-LLM-HOST:11434/v1",
  "llmModel": "llama3.1",
  "whisperMode": "remote",
  "whisperEndpoint": "http://YOUR-WHISPER-HOST:8000/v1",
  "whisperModel": "Systran/faster-whisper-base",
  "baseUrl": "http://YOUR-HUSHPOD-HOST:3000"
}'
```

Set `whisperMode: "local"` to transcribe with whisper.cpp in-process instead.

### Subscribe and process

```sh
curl -X POST localhost:3000/api/shows -H 'content-type: application/json' \
  -d '{"feedUrl":"https://feeds.npr.org/510318/podcast.xml"}'

curl localhost:3000/api/status          # watch the queue
```

Clean feed: `GET /feed/{slug}` (or `/feed/all`). Subscribe to that URL in your
podcast app.

## Key design decisions

- **The LLM never emits timestamps.** Whisper segments get stable ids; the LLM
  returns segment-id ranges, and we map those back to exact times. Avoids the
  timestamp-hallucination failure mode.
- **Originals are always retained** so detection/cutting can be re-run
  (`POST /api/episodes/:id/reprocess`) without re-downloading or re-transcribing.
- **Episode identity comes from the RSS `<guid>`**, never the enclosure URL
  (CDNs inject per-request tracking params).

## Scripts

- `pnpm dev` — run the server (watch mode)
- `pnpm db:generate` — generate a migration after schema changes
- `pnpm db:migrate` — apply migrations
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm build` — build client (Vite) + server (tsup)
