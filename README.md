# HushPod

[![CI](https://github.com/edspencer/hushpod/actions/workflows/ci.yml/badge.svg)](https://github.com/edspencer/hushpod/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Self-hosted podcast ad remover. Subscribes to RSS feeds, downloads episodes,
transcribes them, detects ads/promos/intros/outros with an LLM, cuts them out
with FFmpeg, and serves clean ad-free RSS feeds you can subscribe to from any
podcast app.

TypeScript end to end. See [`hushpod-spec.md`](./hushpod-spec.md) for the full
design and [`docs/prior-art-lessons.md`](./docs/prior-art-lessons.md) for
lessons distilled from prior art (MinusPod / Podly / AGPAR).

## Status

Functional end to end — the full pipeline has been validated on real feeds with
a local Ollama model, and the web UI + Docker image are working.

| Step                                                      | State                                    |
| --------------------------------------------------------- | ---------------------------------------- |
| Feed subscribe / parse / discovery                        | ✅ proven on real feeds                  |
| Download (CDN redirects, byte cap, content-type)          | ✅                                       |
| Transcribe (local whisper.cpp / remote OpenAI-compatible) | ✅ chunked, Metal-accelerated, validated |
| Ad detection (LLM, segment-id mapping + JSON repair)      | ✅ validated with Ollama qwen2.5:14b     |
| Cut (FFmpeg, keep-range math, transition-sound detection) | ✅ proven on real audio                  |
| Clean RSS (ETag/304) + Range audio serving                | ✅ proven (206 + 304)                    |
| React UI (dashboard, show/episode, player, settings)      | ✅ builds + serves                       |
| Docker image                                              | ✅ builds, boots, serves                 |

Validated locally: subscribing to NPR's Up First, all 10 episodes processed
through transcribe→detect→cut with Ollama; advertisers correctly extracted
(AT&T, Progressive, Mint Mobile, Schwab, Carvana).

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

Use the Settings page in the UI, or `PATCH /api/settings`. For a local
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

## Docker

Build locally:

```sh
docker compose up --build
```

Or pull the prebuilt multi-arch image published by CI (no build toolchain needed
on the host):

```sh
docker run -d --name hushpod -p 3000:3000 -v hushpod-data:/app/data \
  ghcr.io/edspencer/hushpod:latest
```

Serves on port 3000 with the data directory mounted as a volume. The image
bundles FFmpeg and the whisper.cpp build toolchain (cmake/make/g++), so local
transcription works out of the box. To reach a host-local Ollama from the
container, set the LLM base URL to `http://host.docker.internal:11434/v1`.

## Deployment: Proxmox + OPNsense

How this is run in a homelab — a Docker host on a Proxmox cluster, reached at a
friendly hostname via OPNsense DNS.

### 1. Host the container on Proxmox

Use a VM, or a **privileged** LXC with nesting enabled (Docker in an
unprivileged LXC is fiddly). In the Proxmox shell for the container/VM:

```sh
# install Docker, then:
mkdir -p /opt/hushpod && cd /opt/hushpod
# create docker-compose.yml (see repo) or run directly:
docker run -d --name hushpod --restart unless-stopped \
  -p 3000:3000 -v /opt/hushpod/data:/app/data \
  -e HUSHPOD_DATA_DIR=/app/data \
  ghcr.io/edspencer/hushpod:latest
```

Notes:

- **No GPU/Metal** on a Linux Proxmox host — whisper.cpp runs on CPU. Give the
  VM/LXC several cores, or set `whisperMode: remote` and point
  `whisperEndpoint` at a GPU box (e.g. `faster-whisper-server`).
- The LLM endpoint must be reachable from the container — point `llmBaseUrl` at
  an Ollama/LLM host on the LAN (e.g. `http://10.0.0.x:11434/v1`).
- Persist `/app/data` (SQLite DB + audio) on a bind mount or volume so episodes
  survive restarts/upgrades.

### 2. DNS in OPNsense

Give it a hostname (e.g. `hushpod.home.arpa` or `hushpod.lan`):

1. **Services → Unbound DNS → Overrides → Host Overrides → Add.**
2. Host `hushpod`, Domain `home.arpa` (or your local domain), Type `A`, IP =
   the container/VM's address. Save & apply.
3. Clients on the LAN can now reach `http://hushpod.home.arpa:3000`.

### 3. (Optional) Reverse proxy + TLS

To drop the `:3000` and add HTTPS, put a reverse proxy in front (Caddy is the
least effort, or the OPNsense Caddy/nginx plugin / Traefik):

```caddy
hushpod.home.arpa {
    reverse_proxy 10.0.0.x:3000
}
```

### 4. Set the public base URL

So the generated RSS feeds use the right absolute URLs, set `baseUrl` to however
clients reach HushPod (Settings page or API):

```sh
curl -X PATCH http://hushpod.home.arpa:3000/api/settings \
  -H 'content-type: application/json' \
  -d '{"baseUrl":"https://hushpod.home.arpa"}'
```

Then subscribe your podcast app to `https://hushpod.home.arpa/feed/{slug}`.

## Development

```sh
pnpm install
pnpm dev          # API server (http://localhost:3000)
pnpm dev:client   # Vite dev server (http://localhost:5173, proxies to :3000)
```

Before pushing, the same checks CI runs:

```sh
pnpm typecheck
pnpm lint
pnpm format:check   # pnpm format to auto-fix
pnpm test
pnpm build
```

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
- `pnpm dev:client` — Vite dev server with API proxy
- `pnpm db:generate` — generate a migration after schema changes
- `pnpm db:migrate` — apply migrations
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm lint` / `pnpm lint:fix` — ESLint
- `pnpm format` / `pnpm format:check` — Prettier
- `pnpm test` — run the test suite
- `pnpm build` — build client (Vite) + server (tsup)

## License

[MIT](./LICENSE) © Ed Spencer
