# HushPod — Self-Hosted Podcast Ad Remover

## Vision

An open-source, self-hosted podcast server that subscribes to RSS feeds, downloads episodes, transcribes them, detects and removes ads using AI, and serves clean ad-free RSS feeds you can subscribe to from any podcast app. Built with TypeScript, designed for Apple Silicon, and deployable anywhere via Docker.

## Problem

Podcast ad injection has gotten aggressive. Dynamically inserted ads interrupt content, wake you up when falling asleep, and degrade the listening experience. Existing solutions (AGPAR, MinusPod, Podly) are Python-based, have mediocre UIs, and require source code hacking to support local LLMs like Ollama.

## Goals

- **Clean, modern TypeScript codebase** — no Python, no source hacking for LLM configuration
- **First-class local LLM support** — Ollama, any OpenAI-compatible endpoint, plus commercial APIs, all via Vercel AI SDK
- **Beautiful UI** — Tailwind CSS + shadcn/ui, responsive, dark mode
- **Structured ad tracking** — ads are first-class entities, not just deleted segments
- **Context-aware detection** — use ad history from previous episodes to improve detection
- **Apple Silicon optimized** — native whisper.cpp with Core ML acceleration
- **Distributable** — Docker image, works on any Linux/Mac host

## Non-Goals (v1)

- Waveform editor for manual ad boundary adjustment
- Audio fingerprinting / jingle catalog (ChromaPrint or similar)
- Cross-show pattern learning / community pattern sharing
- Podcast search/discovery (subscribe by URL only in v1)
- User authentication / multi-user (playback position tracked via localStorage)

---

## Architecture

### Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Hono (TypeScript, Node.js) |
| **Frontend** | React + Vite + Tailwind CSS v4 + shadcn/ui |
| **Database** | SQLite via Drizzle ORM + `better-sqlite3` |
| **AI (LLM)** | Vercel AI SDK (`ai`) with provider packages |
| **AI (Transcription)** | `nodejs-whisper` (local) or remote OpenAI-compatible API |
| **Audio Processing** | FFmpeg (shelled out) |
| **Validation** | Zod (shared between API routes, DB schema, LLM output) |
| **Package Manager** | pnpm |
| **Runtime** | Node.js 22+ |

### Project Structure

```
hushpod/
├── src/
│   ├── server/              # Hono backend
│   │   ├── index.ts         # Server entrypoint
│   │   ├── routes/          # API routes (Zod-validated)
│   │   │   ├── shows.ts
│   │   │   ├── episodes.ts
│   │   │   ├── ads.ts
│   │   │   ├── feeds.ts
│   │   │   └── settings.ts
│   │   ├── services/        # Business logic
│   │   │   ├── feed.ts      # RSS fetch, parse, episode discovery
│   │   │   ├── downloader.ts
│   │   │   ├── transcriber.ts
│   │   │   ├── detector.ts  # LLM ad detection
│   │   │   ├── cutter.ts    # FFmpeg ad removal
│   │   │   └── processor.ts # Orchestrates the pipeline
│   │   ├── db/
│   │   │   ├── index.ts     # Drizzle instance
│   │   │   ├── schema.ts    # All table definitions
│   │   │   └── migrations/
│   │   └── lib/
│   │       ├── rss.ts       # RSS generation for clean feeds
│   │       └── whisper.ts   # Whisper abstraction (local or remote)
│   ├── client/              # React SPA
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ui/          # shadcn components
│   │   │   ├── ShowList.tsx
│   │   │   ├── EpisodeList.tsx
│   │   │   ├── EpisodePlayer.tsx  # HTML5 audio player with position tracking
│   │   │   ├── AdTable.tsx
│   │   │   ├── ProcessingLog.tsx
│   │   │   └── Settings.tsx
│   │   └── lib/
│   │       ├── api.ts       # Typed API client (Hono RPC)
│   │       └── playback.ts  # localStorage playback position persistence
│   └── shared/
│       └── schemas.ts       # Zod schemas shared between client and server
├── drizzle/                 # Generated migrations
├── data/                    # Runtime data (SQLite DB, audio files)
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── vite.config.ts
└── drizzle.config.ts
```

### Monorepo vs Single Package

Single package. The frontend is built by Vite and served statically by Hono. No need for a monorepo — this is one application.

---

## Data Model

### Shows

A podcast feed that HushPod subscribes to.

```ts
export const shows = sqliteTable('shows', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  feedUrl: text('feed_url').notNull().unique(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  imageUrl: text('image_url'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  episodeLimit: integer('episode_limit').notNull().default(10),
  removeAds: integer('remove_ads', { mode: 'boolean' }).notNull().default(true),
  removePromos: integer('remove_promos', { mode: 'boolean' }).notNull().default(true),
  lastCheckedAt: integer('last_checked_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})
```

### Episodes

An individual episode from a show's RSS feed.

```ts
export const episodes = sqliteTable('episodes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  showId: integer('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
  guid: text('guid').notNull(),                    // RSS <guid>, unique per show
  title: text('title').notNull(),
  description: text('description'),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  sourceUrl: text('source_url').notNull(),          // Original audio URL from RSS
  duration: real('duration'),                       // Seconds (from RSS or detected)
  originalPath: text('original_path'),              // Local path to downloaded original
  cleanPath: text('clean_path'),                    // Local path to ad-free version
  originalSize: integer('original_size'),           // Bytes
  cleanSize: integer('clean_size'),                 // Bytes
  transcript: text('transcript'),                   // Full transcript JSON
  status: text('status', {
    enum: ['pending', 'downloading', 'transcribing', 'detecting', 'cutting', 'done', 'error']
  }).notNull().default('pending'),
  errorMessage: text('error_message'),
  retryCount: integer('retry_count').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  uniqueGuidPerShow: unique().on(table.showId, table.guid),
}))
```

### Ads

An individual ad segment detected within an episode. Each ad is a separate record, even when multiple ads are placed back-to-back in an ad break.

```ts
export const ads = sqliteTable('ads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  episodeId: integer('episode_id').notNull().references(() => episodes.id, { onDelete: 'cascade' }),
  showId: integer('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
  startTime: real('start_time').notNull(),          // Seconds from episode start
  endTime: real('end_time').notNull(),              // Seconds from episode start
  label: text('label', {
    enum: ['ad', 'promo', 'intro', 'outro']
  }).notNull().default('ad'),
  company: text('company'),                         // Advertiser name (e.g., "Curiosity Stream")
  adText: text('ad_text'),                          // Transcript text of the ad
  reason: text('reason'),                           // Why the LLM classified this as an ad
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})
```

### Settings

Application-level configuration stored in the database.

```ts
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})
```

Settings include: `whisperModel`, `whisperEndpoint` (empty = local), `llmProvider`, `llmModel`, `checkIntervalMinutes`, `baseUrl`, `dataDir`, `enableTransitionDetection`, `transitionWindowSeconds`, `transitionEnergyThreshold`.

---

## Processing Pipeline

Each episode goes through a linear pipeline. The `processor` service orchestrates this, processing episodes concurrently (configurable concurrency limit, default 2).

### 1. Feed Check

- On a configurable interval (default: 60 minutes), fetch each active show's RSS feed
- Parse with `rss-parser`
- Discover new episodes not already in the database
- Insert up to `episodeLimit` most recent episodes as `pending`
- Skip episodes already in DB (matched by `guid`)

### 2. Download

- Fetch the audio file from `sourceUrl` (follow redirects, handle CDN chains)
- Save to `data/shows/{slug}/{guid}/original.{ext}`
- Update episode status to `downloading`, then to `transcribing` on success

### 3. Transcribe

- **Local mode** (default): Use `nodejs-whisper` with configurable model (default: `base`)
- **Remote mode**: POST audio to an OpenAI-compatible `/v1/audio/transcriptions` endpoint
- Store timestamped transcript as JSON on the episode record
- For episodes over 20 minutes, chunk the audio (20-minute segments with 20-second overlap) and merge transcripts
- Update status to `detecting`

### 4. Detect Ads

This is the core intelligence step.

**Prompt construction:**

1. System prompt explaining the task: identify ad/promo/intro/outro segments in a podcast transcript
2. The full timestamped transcript of the current episode
3. **Context from the previous episode** of the same show: the list of ads found (company, ad text, start/end times, labels). This guides the LLM on what to expect — similar ad slots, similar advertisers, similar ad copy.

**LLM call:**

Use Vercel AI SDK `generateObject` with a Zod schema to get structured output:

```ts
const AdSegmentSchema = z.object({
  segments: z.array(z.object({
    startTime: z.number().describe('Start time in seconds'),
    endTime: z.number().describe('End time in seconds'),
    label: z.enum(['ad', 'promo', 'intro', 'outro']),
    company: z.string().nullable().describe('Advertiser/company name if identifiable'),
    adText: z.string().describe('The transcript text of this ad segment'),
    reason: z.string().describe('Brief explanation of why this is an ad'),
  }))
})

const { object } = await generateObject({
  model: provider(modelName),
  schema: AdSegmentSchema,
  prompt: buildDetectionPrompt(transcript, previousEpisodeAds),
})
```

**Store results:** Insert each detected segment as an `ad` record. Update episode status to `cutting`.

### 5. Transition Sound Detection (Optional)

After the LLM identifies ad boundaries, an optional audio analysis pass detects and strips chimes, jingles, and transition sounds that immediately precede or follow ad segments. These are the short, often loud sounds producers use to signal ad breaks — and they're just as disruptive as the ads themselves.

**How it works:**

1. For each detected ad segment, extract a short audio window: 5 seconds before `startTime` and 5 seconds after `endTime` (configurable via `transitionWindowSeconds` setting).

2. Use FFmpeg to extract raw PCM samples for these windows:
   ```bash
   ffmpeg -i original.mp3 -ss <start-5> -t 10 -f f32le -acodec pcm_f32le -ac 1 -ar 16000 pipe:1
   ```

3. Compute RMS energy in a sliding window (100ms steps, 200ms window) across the extracted audio. Chimes and jingles produce sharp energy spikes — typically 2–4× the RMS of surrounding speech.

4. If a spike is found within the window that exceeds the threshold (configurable, default: 2.5× the mean RMS of the surrounding speech), extend the ad boundary to include it. The extension snaps to the nearest silence (RMS below a noise floor threshold) to ensure clean cuts.

**Configuration:**
- `enableTransitionDetection`: boolean (default: `true`)
- `transitionWindowSeconds`: how far before/after each ad boundary to search (default: `5`)
- `transitionEnergyThreshold`: RMS multiplier for spike detection (default: `2.5`)

**Why this approach works for v1:**
- Chimes are short (0.5–3s), high-energy relative to speech — easy to detect with basic signal analysis
- They occur at predictable locations (near ad boundaries the LLM already found)
- No audio fingerprint database needed
- The energy computation is trivial in raw PCM — just sum-of-squares over a sliding window
- False positives are rare because the search window is small (only near known ad boundaries)

**Future enhancement (v2):** Build a catalog of known transition sounds per show using audio fingerprinting (ChromaPrint). Compare short audio segments against the catalog for more precise detection, handling cases where jingles have similar energy to surrounding content.

### 6. Cut

- Use FFmpeg to remove ad segments from the audio (boundaries may have been extended by transition sound detection)
- Merge adjacent non-ad segments with crossfade (configurable, default: 0ms — hard cut)
- Save to `data/shows/{slug}/{guid}/clean.{ext}`
- Record `cleanPath` and `cleanSize` on the episode
- Update status to `done`

### 7. Serve Clean RSS

- For each show, generate a modified RSS feed at `/feed/{slug}`
- The feed mirrors the original but replaces `<enclosure>` URLs with links to the clean audio files served by HushPod
- Also serve a unified feed at `/feed/all` combining all shows
- Serve clean audio files at `/audio/{showSlug}/{guid}/clean.mp3`
- Use the `baseUrl` setting to construct absolute URLs in the feed

---

## API Design

All routes use `@hono/zod-validator` for request validation. Response schemas are also defined in Zod for type safety.

### Shows

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/shows` | List all shows |
| `POST` | `/api/shows` | Subscribe to a new show (accepts `feedUrl`) |
| `GET` | `/api/shows/:id` | Get show details with episode summary |
| `PATCH` | `/api/shows/:id` | Update show settings |
| `DELETE` | `/api/shows/:id` | Unsubscribe and optionally delete data |

### Episodes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/shows/:showId/episodes` | List episodes for a show |
| `GET` | `/api/episodes/:id` | Get episode details including ads |
| `POST` | `/api/episodes/:id/reprocess` | Re-run ad detection and cutting |

### Ads

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/episodes/:episodeId/ads` | List ads for an episode |
| `GET` | `/api/shows/:showId/ads` | List all ads across a show |
| `GET` | `/api/ads/stats` | Aggregate ad statistics (count by company, by show, over time) |

### Feeds

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/feed/:slug` | Clean RSS feed for a show |
| `GET` | `/feed/all` | Unified clean RSS feed |
| `GET` | `/audio/:slug/:guid/clean.mp3` | Serve clean episode audio |
| `GET` | `/audio/:slug/:guid/original.mp3` | Serve original episode audio |

### Settings

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/settings` | Get all settings |
| `PATCH` | `/api/settings` | Update settings |

### System

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/status` | Processing queue status, system health |

---

## UI Design

### Pages

**Dashboard** (`/`)
- List of subscribed shows as cards with cover art, title, episode count, processing status
- Global stats: total episodes processed, total ads removed, total ad time removed
- "Add Show" button → modal with RSS URL input

**Show Detail** (`/shows/:id`)
- Show info (title, description, cover art, feed URL)
- Episode list with status badges (pending, processing, done, error)
- Per-show ad statistics: ads per episode trend, top advertisers
- Show settings (episode limit, remove ads/promos toggles)
- Clean RSS feed URL (copyable)

**Episode Detail** (`/episodes/:id`)
- Episode info (title, published date, duration)
- **Audio player** (see below)
- Processing status and log
- Ad list: each ad as a card showing company name, timestamp range, ad text, label
- Original vs clean duration comparison
- Download links for original and clean audio

**Settings** (`/settings`)
- LLM provider selection (Ollama, OpenAI, Anthropic, custom)
- LLM model name
- Whisper configuration (local model or remote endpoint URL)
- Base URL
- Check interval
- Data directory
- Transition sound detection: enable/disable, window size (seconds), energy threshold multiplier

### Audio Player (`EpisodePlayer`)

A custom HTML5 audio player embedded in the Episode Detail page for listening to episodes directly in the browser.

**Features:**
- Play/pause, scrub bar, current time / total duration display
- Playback speed control (0.5×, 0.75×, 1×, 1.25×, 1.5×, 2×)
- Toggle between clean and original audio (with button showing which is active)
- Visual markers on the scrub bar showing where ads were detected (colored segments)
- Volume control

**Playback position persistence (`playback.ts`):**

Position is tracked in `localStorage` under a key like `hushpod:position:{episodeId}`:

```ts
interface PlaybackState {
  position: number      // Seconds
  speed: number         // Playback rate
  version: 'clean' | 'original'  // Which audio was playing
  updatedAt: number     // Timestamp for cleanup
}
```

- Position saved on every `timeupdate` event (throttled to once per 2 seconds)
- On mount, seek to saved position if one exists
- On episode completion (ended event), clear the saved position
- Stale entries (older than 90 days) cleaned up periodically

This avoids any server-side user/session concept. Each browser maintains its own position state. If multi-user tracking is needed later, positions can be migrated to a `playback_positions` DB table keyed by `(userId, episodeId)`.

### Design Principles

- Dark mode by default, light mode toggle
- Responsive (usable on phone for checking status)
- No unnecessary chrome — information-dense, clean layout
- Status updates without page refresh (polling or SSE)

---

## LLM Provider Configuration

The Vercel AI SDK provides a unified interface. HushPod supports:

| Provider | Package | Configuration |
|----------|---------|---------------|
| Ollama (local) | `ollama-ai-provider` | Model name, optional base URL |
| OpenAI | `@ai-sdk/openai` | API key, model name |
| Anthropic | `@ai-sdk/anthropic` | API key, model name |
| OpenAI-compatible | `@ai-sdk/openai` | API key, model name, custom base URL |

Provider and model are configured via the Settings UI and stored in the database. The backend instantiates the appropriate provider at runtime.

---

## Whisper Configuration

Two modes:

### Local (default)

Uses `nodejs-whisper` which compiles and runs whisper.cpp locally. Configurable model size (tiny, base, small, medium, large). On Apple Silicon, runs with ARM NEON acceleration. For CoreML/Neural Engine acceleration, users can build whisper.cpp manually and configure HushPod to shell out to the binary.

### Remote

Any OpenAI-compatible `/v1/audio/transcriptions` endpoint. Configure the endpoint URL in settings. Useful for offloading transcription to a GPU server running `faster-whisper-server` or similar.

---

## Docker Distribution

```dockerfile
FROM node:22-slim
RUN apt-get update && apt-get install -y ffmpeg make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
EXPOSE 3000
VOLUME /app/data
CMD ["node", "dist/server/index.js"]
```

The Docker image includes FFmpeg and build tools for whisper.cpp compilation. The `/app/data` volume persists the SQLite database and audio files.

Multi-arch builds (`linux/amd64`, `linux/arm64`) for broad compatibility.

---

## Implementation Notes

### Prior Art Analysis

Before implementing the ad detection and audio processing logic, an agent should analyze MinusPod's commit history (~769 commits) to extract lessons learned:

- Edge cases in RSS feed parsing (redirects, auth headers, non-standard feeds)
- Whisper failure modes (hallucination on silence, out-of-memory on long episodes)
- LLM output parsing failures (malformed JSON, timestamps outside episode bounds)
- FFmpeg cutting edge cases (codec compatibility, chapter markers, metadata preservation)
- Episode download gotchas (CDN redirect chains, rate limiting, partial downloads)

This analysis should produce a "lessons learned" document that informs implementation decisions and test cases.

### Concurrency

- Feed checking runs on a timer (setInterval)
- Episode processing uses a simple queue with configurable concurrency (default: 2)
- SQLite handles concurrent reads fine; writes are serialized by `better-sqlite3` (synchronous driver)
- The processing queue is in-memory; on restart, episodes with status `downloading`/`transcribing`/`detecting`/`cutting` are reset to `pending`

### Error Handling

- Each pipeline step can fail independently
- On failure: set status to `error`, record error message, increment retry count
- Auto-retry up to 3 times with exponential backoff
- Failed episodes surface in the UI with error details

### Audio Storage

```
data/
├── hushpod.db              # SQLite database
└── shows/
    └── {slug}/
        └── {guid}/
            ├── original.mp3   # Always retained
            ├── clean.mp3      # Generated after ad removal
            └── transcript.json
```

**Both original and clean audio are always retained.** The original is needed for reprocessing — if the LLM detection improves, or settings change (e.g., enabling transition sound detection), any episode can be re-run through the pipeline from the detection step without re-downloading or re-transcribing. The `POST /api/episodes/:id/reprocess` endpoint triggers this.

Retention is configurable per show. Default: keep last N episodes (matching the show's `episodeLimit`). When episodes age out, **both** audio files are deleted but their metadata (including ad records) is retained in the database for historical analysis.

---

## Future Considerations (v2+)

- **Pattern learning**: Use the `ads` table to build a library of known ad patterns per show/network. Inject these into detection prompts for higher accuracy.
- **Ad analytics dashboard**: Visualize ad frequency, top advertisers, ad time trends over seasons.
- **Jingle catalog**: Build a per-show library of known transition sounds using audio fingerprinting (ChromaPrint). Compare short audio clips against the catalog for more precise chime detection beyond the energy-based approach in v1.
- **Audio fingerprinting**: ChromaPrint for detecting dynamically inserted ads that vary between downloads.
- **Podcast search**: Integrate with iTunes/Podcast Index API for feed discovery.
- **OPML import**: Bulk-subscribe from an existing podcast app's export.
- **Webhook notifications**: Notify when new clean episodes are ready.
- **Multi-user**: Authentication, per-user subscriptions, server-side playback position tracking (migrate from localStorage).
- **Verification pass**: Re-transcribe cut audio to check for clean transitions.
