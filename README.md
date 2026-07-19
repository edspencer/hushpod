# HushPod

[![CI](https://github.com/edspencer/hushpod/actions/workflows/ci.yml/badge.svg)](https://github.com/edspencer/hushpod/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Self-hosted podcast ad remover. Subscribes to RSS feeds, downloads episodes,
transcribes them, detects ads, promos, and recurring "fluff" (the show's
intro spiel, sign-off, and credits) with an LLM, cuts out what you choose per
show with FFmpeg, and serves clean RSS feeds you can subscribe to from any
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

## Deployment (reference architecture)

This is how the author actually runs HushPod, and a recipe to reproduce it. The
orchestrator (download → transcribe → detect → cut → serve) runs in Docker on a
Proxmox cluster, while the two GPU-hungry steps — transcription and ad detection
— are offloaded to a spare Apple-Silicon Mac, which has far more usable AI
throughput than a CPU-only Proxmox node.

```
                ┌───────────────────────────── LAN ─────────────────────────────┐
  podcast apps ─┤  OPNsense (Unbound DNS): hushpod.home.arpa ─┐                   │
                │                                             ▼                   │
                │                              Caddy (reverse proxy + TLS)        │
                │                                             │                   │
                │                                             ▼                   │
                │   Proxmox ── HushPod container (ghcr.io/edspencer/hushpod)      │
                │      • SQLite on LOCAL disk    • media on NAS (NFS/SMB)         │
                │                     │  remote whisper + LLM over HTTP           │
                │                     ▼                                           │
                │   Spare Apple-Silicon Mac (always-on AI host)                  │
                │      • whisper-server (Metal)     • Ollama (Metal)              │
                └────────────────────────────────────────────────────────────────┘
```

### Can't I just run everything in the container?

- **Whisper:** yes — whisper.cpp compiles and runs inside the HushPod image, but
  CPU-only (no Metal/CUDA in a typical Proxmox container), so it's slow on long
  episodes. Fine for light use: set `whisperMode: local` and give the container
  plenty of cores.
- **Ollama:** no, it isn't bundled. You'd run it as its own container, and a 14B
  model is only practical with a GPU passed through (NVIDIA on Linux). On a
  CPU-only node it's too slow to be useful.

So a fully self-contained, all-in-Docker deployment is great **if your Proxmox
host has a GPU you can pass through**. Without one, offloading to an
Apple-Silicon Mac (Metal) is the pragmatic high-performance option — and it puts
otherwise-idle hardware to work. An M1/M2 with 32–64 GB RAM comfortably runs
`whisper` plus a quantized 14B model.

### 1. AI host — a spare Apple-Silicon Mac (Ollama + whisper, Metal)

Give it a static IP / DHCP reservation (referred to below as `192.168.1.x`).

**Ollama** (ad detection):

```sh
brew install ollama
# Listen on the LAN, not just localhost:
launchctl setenv OLLAMA_HOST "0.0.0.0:11434"
# restart Ollama, then pull a model:
ollama pull qwen2.5:14b
```

**whisper-server** (transcription) — build whisper.cpp once:

```sh
brew install cmake
git clone https://github.com/ggml-org/whisper.cpp && cd whisper.cpp
cmake -B build && cmake --build build -j --config Release
sh ./models/download-ggml-model.sh base       # or small / medium
./build/bin/whisper-server -m models/ggml-base.bin \
  --host 0.0.0.0 --port 8385 \
  --inference-path /v1/audio/transcriptions -l en -t 8
```

The `--inference-path /v1/audio/transcriptions` flag makes whisper-server match
HushPod's OpenAI-compatible client exactly, so no adapter is needed.

**macOS firewall** — allow incoming connections to both processes (on a trusted
LAN you can alternatively just turn the firewall off):

```sh
FW=/usr/libexec/ApplicationFirewall/socketfilterfw
sudo "$FW" --add "$(pwd)/build/bin/whisper-server"
sudo "$FW" --unblock "$(pwd)/build/bin/whisper-server"
# Ollama typically prompts to allow incoming connections on first use — approve it.
```

**Keep it always-on** — disable sleep (System Settings → Battery, or
`caffeinate -dimsu`), and run `ollama serve` and the `whisper-server` command as
launchd LaunchAgents so they come back after a reboot. If the Mac sleeps or
leaves the network, processing stalls until it returns.

### 2. HushPod on Proxmox (the published image)

Use a VM, or a **privileged** LXC with nesting enabled (Docker in an
unprivileged LXC is fiddly). `docker-compose.yml`:

```yaml
services:
  hushpod:
    image: ghcr.io/edspencer/hushpod:latest
    restart: unless-stopped
    ports: ['3000:3000']
    volumes:
      - /mnt/nas/hushpod/media:/app/data # media → NAS (large, write-once)
      - /opt/hushpod/db:/app/db # SQLite → LOCAL disk (see below)
    environment:
      - HUSHPOD_DATA_DIR=/app/data
      - HUSHPOD_DB_PATH=/app/db/hushpod.db
```

```sh
docker compose up -d        # `docker compose pull && docker compose up -d` to upgrade
```

### 3. Storage — NAS for media, local disk for SQLite

Media files are large and effectively write-once, so a NAS share is ideal for
`/app/data` (which holds `shows/…/{original,clean}.mp3` and transcripts).

**Do not put the SQLite database on an NFS/SMB share.** SQLite's file locking
(especially in WAL mode) is unreliable over network filesystems and can hang or
corrupt. Keep `hushpod.db` on the node's local disk (or block storage that
presents as local) via `HUSHPOD_DB_PATH`, as in the compose above. The database
is small, so this costs almost nothing.

### 4. DNS — OPNsense (Unbound)

**Services → Unbound DNS → Overrides → Host Overrides → Add**: host `hushpod`,
your local domain (e.g. `home.arpa`), type `A`, IP of the Caddy/Proxmox host.
Clients then resolve `hushpod.home.arpa` on the LAN.

### 5. Reverse proxy + TLS — Caddy

```caddy
hushpod.home.arpa {
    reverse_proxy <proxmox-host-ip>:3000
    tls internal   # Caddy issues its own cert for an internal domain
}
```

Note: HushPod has **no authentication** — keep it on the trusted LAN and don't
port-forward it. If you do front it with auth, the `/feed/*` and `/audio/*`
routes must stay reachable without a login, because podcast apps can't
authenticate interactively.

### 6. Point HushPod at the AI host

Via the Settings page, or the API:

```sh
curl -X PATCH https://hushpod.home.arpa/api/settings \
  -H 'content-type: application/json' -d '{
    "whisperMode": "remote",
    "whisperEndpoint": "http://192.168.1.x:8385/v1",
    "whisperModel": "base",
    "llmProvider": "openai-compatible",
    "llmBaseUrl": "http://192.168.1.x:11434/v1",
    "llmModel": "qwen2.5:14b",
    "baseUrl": "https://hushpod.home.arpa",
    "concurrency": 1
  }'
```

Use `concurrency: 1` when whisper and Ollama share a single Mac GPU — it stops
them fighting over the GPU and is usually faster per episode. Then subscribe
your podcast app to `https://hushpod.home.arpa/feed/{slug}`.

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

## Releasing

Versioning, the changelog, git tags, and GitHub Releases are managed with
[Changesets](https://github.com/changesets/changesets). We do **not** publish to
npm — the package is `private` — so this is versioning + `CHANGELOG.md` +
tag/Release only.

**Adding a changeset (do this in any PR with a user-visible change):**

```sh
pnpm changeset          # pick the bump (patch / minor / major), write a summary
```

That writes a small markdown file under `.changeset/`; commit it with your
change. Docs-only or internal refactors that don't warrant a release note can
skip it. To preview what's pending, run `pnpm changeset status`.

**How a release happens (automated):** when changesets land on `main`, the
[Release workflow](.github/workflows/release.yml) opens a **"Version Packages"**
PR that bumps `version` in `package.json` and folds the pending changesets into
`CHANGELOG.md`. Merging that PR tags the commit `vX.Y.Z` and creates the matching
**GitHub Release**. That `v*` tag also triggers [`docker.yml`](.github/workflows/docker.yml),
so the multi-arch image publishes for the release automatically. No tags or
version bumps are pushed by hand.

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
