# Prior-Art Lessons for HushPod

Concrete, actionable lessons mined from prior-art self-hosted podcast ad-removers, to de-risk
HushPod's ad-detection and audio-processing pipeline before we build it.

## Sources analyzed

All three named prior-art projects were found, cloned, and analyzed (source + full commit history):

| Project | Repo | Commits | Notes |
|---|---|---|---|
| **MinusPod** (primary) | https://github.com/ttlequals0/minuspod | **769** (matches spec) | Python/Flask. Whisper -> LLM -> FFmpeg. Cross-episode pattern learning, verification pass, benchmark harness. By far the most mature and the richest source of lessons. |
| **Podly / PodlyPure** | https://github.com/podly-pure-podcasts/podly_pure_podcasts | 670 | Python. The original "adblock for podcasts" (Show HN). |
| **AGPAR** | https://github.com/jdcb4/podcast-ad-remover | 187 | Python. Gemini/GPT/Claude + Whisper + FFmpeg, generates per-subscription RSS. |

Most lessons below are drawn from MinusPod because its commit history is an unusually detailed
post-mortem record (its `CHANGELOG.md` reads like a bug journal). File/commit references are to the
`minuspod` clone unless noted. Cloned to `/tmp/prior-art/{minuspod,podly,agpar}`.

The dominant meta-lesson: **almost every hard bug was an integration/edge-case bug, not an algorithm
bug.** Whisper, the LLM, and FFmpeg mostly work; the failures are in feed quirks, output parsing,
timestamp coordinate systems, caching, and resource limits. Budget accordingly.

---

## 1. RSS feed parsing edge cases

Source: `src/rss_parser.py`, `src/utils/feed_guid.py`, and many `fix(...)` commits.

- **Many feed hosts 403 the default HTTP-client User-Agent.** `feeds.podcastindex.org` (and others)
  reject `python-requests`/generic UAs with 403. MinusPod sets an explicit `APP_USER_AGENT` on every
  request; a bug where the *initial* fetch path was missing the UA broke slug derivation on UA-strict
  hosts. **Set a real, consistent User-Agent on every outbound request from day one** (feed fetch,
  conditional fetch, audio HEAD, audio download). MinusPod uses a browser-like UA for audio downloads
  specifically (CDNs are pickier than feed hosts).

- **Content-Type is unreliable both ways.** Legacy RSS hosts often send *no* `Content-Type`; static
  hosts send `application/octet-stream`. MinusPod treats a missing header as permissive but rejects
  explicit `text/html`/binary (anti-SSRF). Recommendation: accept the union
  `{application/rss+xml, application/atom+xml, application/xml, text/xml, application/octet-stream}`
  plus missing; reject only obviously-wrong types.

- **"Server claims gzip but sends malformed/plain bytes."** A real, recurring failure. MinusPod
  catches the decode error and **retries once with `Accept-Encoding: identity`** before giving up.
  Build this retry in.

- **GUID handling is the linchpin of dedup.** Episode identity must be derived from the RSS `<guid>`
  when present, *not* the enclosure URL, because CDNs inject per-request tracking params
  (Megaphone's `awCollectionId`/`awEpisodeId`, etc.) that change the URL every fetch. MinusPod:
  `episode_id = md5(guid)[:12]`, falling back to `md5(url)[:12]` only when no GUID. There was a
  dedicated bug-fix (`406c676f`) for "episode ID update on GUID change." **Pick the ID scheme once
  and never change it** — it is baked into every subscriber's app (see §6).

- **feedparser flattens namespaced tags across the document.** `feed.image.href` gets clobbered by
  the *last* `<itunes:image>` it sees (usually a per-episode override), so you can end up serving a
  40 MB per-episode GIF as the channel artwork. MinusPod stopped trusting feedparser for artwork and
  **parses raw XML to grab the channel-level `<itunes:image>`/`<image><url>` directly.** Expect to
  drop down to raw XML for anything where channel-vs-item scoping matters.

- **Episode description lives in different tags per publisher.** Many feeds (Relay FM cited) leave
  `<description>` empty and put the summary in `<itunes:subtitle>` or `<content:encoded>`. Use a
  fallback chain: `description -> itunes:subtitle/subtitle -> content:encoded`. Same for channel
  description (`description -> itunes:summary -> subtitle`).

- **Skip entries with no audio enclosure** (trailers-as-text, video-only items). Iterate enclosures
  and pick the first whose `type` contains `audio`.

- **Episode dedup beyond GUID.** Publishers re-publish "updated" episodes with the same title/date.
  MinusPod groups by `(normalized_title, publish_date)` and keeps the latest (`deduplicate_episodes`),
  which matches what podcast apps show. Worth replicating so re-uploads don't double-process.

- **Date parsing must tolerate garbage.** pubDate parsing is wrapped to fall back to a date-prefix
  slice; never let one bad date crash a refresh. (There was a crash: `85186f3a` "RSS refresh crash
  from undefined published_str variable.")

- **Bound the feed body size.** MinusPod caps RSS bodies (default 200 MB) to prevent a hostile/broken
  feed from exhausting memory; this is also a decompression-bomb defense.

- **XXE / DOCTYPE defense.** Use a hardened XML parser (`defusedxml`) and additionally pre-scan the
  first ~64 KB for `<!DOCTYPE`/`<!ENTITY>` and reject — feedparser swallows the defused exception and
  reports a useless generic "syntax error" otherwise. **For TypeScript: pick an XML parser that does
  not resolve external entities by default** (most JS parsers don't, but verify) and reject DOCTYPE.

- **SSRF on every fetch.** Feed URLs are re-fetched on every refresh, so a stored URL is a standing
  DNS-rebinding vector. MinusPod resolves and blocks private/loopback/cloud-metadata targets *per
  redirect hop* by default, with an opt-in env for LAN feeds. **Strip provider/auth headers (e.g.
  `x-api-key`) when a redirect crosses to a different host.**

- **Circuit-break per host.** One dead feed host shouldn't stall refreshes of all others. MinusPod
  keeps a per-hostname circuit breaker (5 failures -> 60 s open).

---

## 2. Whisper / transcription failure modes

Source: `src/transcriber.py`, plus VAD/OOM/hallucination commits.

- **Hallucination on silence/music is real and must be filtered.** Whisper emits canned phrases on
  near-silent or musical audio: "Thanks for watching", "Please subscribe", "Subtitles by the
  amara.org community", `[music]`, "you", bare punctuation. MinusPod keeps a regex blocklist
  (`HALLUCINATION_PATTERNS`) applied after transcription. Also filters **consecutive identical
  segments** (Whisper loop artifacts).

- **The initial-prompt vocabulary leaks back into output.** MinusPod seeds Whisper with an
  ad-vocabulary `initial_prompt` (sponsor names, "promo code", "use code") to improve recognition of
  brand names — but Whisper then sometimes *transcribes the prompt itself*. They added a second filter
  (`VOCABULARY_HALLUCINATION_PATTERNS`) that drops short (<100 char, <15 word) segments that are
  mostly prompt vocabulary. **If you seed an initial prompt, you must filter its echo.**

- **Pin the language; auto-detect misfires on intros.** An English podcast was detected as Spanish at
  93% confidence off a music intro, corrupting the whole transcript. MinusPod defaults
  `whisper_language='en'` and only auto-detects when explicitly configured. Make language a setting,
  default to a fixed language, treat `auto` as opt-in.

- **OOM on long episodes is the #1 resource failure.** Multiple layers of defense:
  - **Adaptive batch size by duration** (`BATCH_SIZE_TIERS`: 16 for <60 min down to 4 for >120 min).
  - **Retry-on-OOM with halved batch size** (up to 3x), clearing CUDA cache between attempts.
  - **Dynamic chunked transcription** when the whole file won't fit: compute chunk size from
    *available* GPU/CPU memory and a per-model memory profile, with a safety margin.
  - **On any failure, fully unload the model and clear GPU memory** before retry — leaked VRAM turns
    one OOM into a cascade.
  - For HushPod (TS, likely calling a Whisper server/API rather than in-process), the analog is:
    chunk long episodes, bound concurrency, and on a 5xx/OOM from the server, back off and shrink the
    chunk. Don't assume a 3-hour episode transcribes in one request.

- **Chunking strategy: overlap + dedup at the seam.** MinusPod overlaps consecutive chunks
  (`CHUNK_OVERLAP_SECONDS`) and merges with a dedup step (`merge_overlapping_segments`, 1 s tolerance)
  so words at the boundary aren't doubled or dropped. Timestamps from each chunk are offset by
  `chunk_start` back into absolute episode time. **Get the offset math and seam-dedup right — this is
  where transcript timestamps silently drift.**

- **Tolerate partial transcription failure.** A flaky chunk shouldn't kill the episode. MinusPod
  allows up to ~20% of chunks to fail, leaves a logged gap, and returns a partial transcript;
  it aborts only past the threshold.

- **Word-level timestamps are essential and not universally available.** MinusPod requests both
  segment- and word-level granularity (`timestamp_granularities[]=['segment','word']`). Word
  timestamps drive precise cut boundaries (§4). But some OpenAI-compatible Whisper servers reject word
  timestamps (OpenVINO returns a 5xx, some faster-whisper builds a 400). MinusPod detects the
  rejection by body-text marker and **retries segment-only**, warning that cuts will be coarser.
  Plan for both modes.

- **Split long segments on word boundaries** (`split_long_segments`, MAX 15 s) so the LLM gets
  finer-grained timestamps to anchor to.

- **Preprocess audio before transcription.** Resample to 16 kHz mono and loudness-normalize
  (`loudnorm` + bandpass) for consistent quality. Scale the FFmpeg timeout by file size (~10 s/MB).

- **Upload-size limits on remote Whisper.** Hosted APIs (OpenAI 25 MB, OpenRouter tighter) reject big
  WAVs. MinusPod compresses to **FLAC (lossless, ~4–5x smaller than WAV)** before upload, with a
  toggle to skip it for self-hosted servers that take WAV directly. There were repeated 413 fixes
  (`69ed7199`). **Use ~10-minute chunks for any hosted Whisper and compress before upload.**

- **Defensive guard: refuse to upload tiny files** (<1 KB) and treat "200 OK + 0 segments" as a
  decode failure on the server side, not a silent empty transcript.

- **Whisper mishears brand names.** MinusPod maintains alias maps (e.g. "Zero" -> "Xero",
  138-entry `SPONSOR_ALIASES`). Cross-episode matching needs fuzzy/alias-aware brand matching, not
  exact string equality.

---

## 3. LLM ad-detection

Source: `src/ad_detector/prompts.py`, `src/utils/llm_response.py`, `src/utils/constants.py`
(`DEFAULT_SYSTEM_PROMPT`), `src/verification_pass.py`, `src/llm_client.py`.

### How they prompt
- **Windowed transcripts, not whole episodes.** Long transcripts exceed context and degrade accuracy.
  MinusPod splits the transcript into **overlapping time windows** (configurable size/overlap) and
  runs detection per window, then merges. Critical guard: **`overlap >= window_size` makes the window
  loop never advance and hangs the worker forever** — there was an explicit fix to fall back to
  non-overlapping windows (`create_windows`, `boundaries`-related). Validate this invariant in
  multiple places (UI, env, and the function itself), because env/DB can bypass UI validation.
- Windows are run **in parallel** via a thread pool (`AD_DETECTION_PARALLEL_WINDOWS`, default 4), with
  **position-indexed merge** so ads stay in transcript order even when futures finish out of order.
- The window prompt tells the model how to handle ads that **straddle window edges** ("continues from
  previous" / "continues in next") so cross-window ads aren't double-counted or truncated. When
  scoring/merging, **dedup overlapping-window predictions** — MinusPod found that not deduping caused
  a systematic downward bias in their benchmark F1.
- The system prompt is long and very explicit about **what is NOT an ad** (silence, topic
  transitions, a guest discussing their own book, host organically mentioning their Patreon, brand
  names in passing). False positives (cutting real content) are treated as worse than false negatives;
  their benchmark optimizes **F0.5** (precision weighted 2x recall). HushPod should adopt the same
  bias — listeners forgive a missed ad, not a cut sentence.
- They inject a **known-sponsor list** into the prompt as high-confidence hints, and include
  few-shot examples (positive ad, negative silence/content gap, and a tricky "brand tagline with no
  promo code" positive).

### Timestamps directly, not segment indices
- The LLM **outputs absolute timestamps in seconds** (`{"start": 45.0, "end": 82.0, ...}`), not
  segment indices. The transcript is fed with `[start --> end]` brackets and the prompt says "use
  absolute timestamps as shown in brackets." Indices would be brittle across windowing/merging.
- **LLM timestamps are approximate / hallucinated and must be corrected against the transcript.**
  This is a whole module (`boundaries.py`): extract brand keywords from the ad, search the transcript
  window for where those keywords actually occur (`validate_ad_timestamps`, `_find_keyword_region`),
  and snap the boundary to the real keyword cluster. Then refine to **word-level** boundaries using
  Whisper word timestamps, optionally extend by trailing ad content (URLs/CTAs), and snap
  near-start ads to 0:00. **Do not cut on raw LLM timestamps.**
  - Edge case they hit: a multi-word sponsor ("Capital One") was split into generic words and "one"
    matched unrelated talk, dragging the cut onto real content. **Keep multi-word sponsor names as a
    single phrase** when keyword-matching.

### Output-parsing failures (expect all of these)
`extract_json_ads_array` tries strategies in order, because no single one is reliable:
1. Direct `JSON.parse`. Handle the model wrapping the array in an object under any of:
   `ads`, `ads_detected`, `advertisement_segments`, `ads_and_sponsorships`, `segments` (filtered to
   `type=="advertisement"`), or a `window` object, or a **single ad object** (wrap in array).
2. Markdown code-fence extraction (```json ... ```).
3. **Bracket-depth scanner** that finds top-level `[...]` arrays while respecting string context
   (a `]` inside a `"..."` must not close the array). Take the *last* valid ad-shaped array.
4. First-`[` to last-`]` fallback.
5. **Salvage a truncated response**: when the model hit `max_tokens` mid-object (no closing brace,
   unclosed string), regex-extract `start`/`end`/`reason` and recover the partial ad rather than
   losing it. Microsoft phi-4 was the canonical offender.
- **Strip chatty preambles** ("Here are the detected ads:", "Based on my analysis...") before parsing.
- **Field names are wildly inconsistent.** Don't hard-code `start`/`end`. MinusPod fuzzy-matches any
  key containing `start`/`end` (excluding traps like `endorser`, `_text`, `_note`, `price_starting`).
- **Confidence comes as float, "95%", or "high"/"medium"/"low".** Normalize: map strings via a table,
  strip `%`, divide by 100 if >1, clamp to [0,1]. Pin "all values MUST be numeric floats" in the
  prompt *and* parse defensively anyway (the prompt instruction alone was insufficient — they shipped
  both `fec6a4ca` prompt enforcement and `b259362d` string-confidence fallback).
- **The model puts its reasoning in the `sponsor` field.** e.g. `"Inferred from ~26 second gap in
  transcript"`. MinusPod rejects sponsor values that are too long (>60 chars), start with reasoning
  prefixes ("inferred from", "based on", "likely", "appears to"), or contain meta substrings ("in
  transcript", "audio signal", "no spoken content"). Keep the ad, drop the bogus sponsor.
- **Reject degenerate ranges** (`end <= start`) and **explicit non-ads** (`is_ad: false`,
  `classification`/`type` in a not-ad set).
- **Require positive evidence.** An ad with no identifiable sponsor/ad-language and low confidence is
  rejected; long no-evidence segments (likely content descriptions) are rejected even at higher
  confidence. This dynamic gate replaced an ever-growing blocklist of content keywords.

### Long transcripts exceeding context
- Solved by windowing (above), not by a single huge call. If a single window's *response* is at risk
  of truncation, the salvage path catches it; also **warn when the response stop reason is
  `max_tokens`/`length`** so you know detections may be incomplete.

### Provider / API mechanics that bit them
- **`max_tokens` vs `max_completion_tokens`.** Newer OpenAI models require `max_completion_tokens`;
  older/compat endpoints require `max_tokens`. Try one, fall back to the other, and **cache which one
  each model accepts** (`#81`, commit `f99fe2f2`).
- **`response_format: {type: "json_object"}` is not universally supported.** LM Studio and some
  OpenAI-compatible endpoints reject it (`0ce6dbc9`). **Probe support at startup; when unsupported,
  inject JSON-only instructions into the prompt instead.** Anthropic doesn't take `response_format`
  at all — they handle it via prompt. Cache the probe result, clear on provider/URL change.
- **Honor `Retry-After` on 429** (parse both delta-seconds and HTTP-date forms, clamp). Use the
  server hint + jitter; fall back to ~30 s base backoff. **Do not count 429s toward the circuit
  breaker** — throttling is back-pressure, not an outage (5 free-tier 429s would otherwise open the
  breaker and block the provider).
- **Don't cache the LLM client on a singleton.** A provider switch in settings rebuilt the global
  client but stale singletons kept hitting the old base URL until restart. Read the client through a
  getter on every call.
- **Pricing/cost accounting drifts.** New models fall through prefix-matching to wrong (often higher)
  rates — Opus 4.8 was billed at ~3x via an Opus 4.0 prefix match. If you surface cost, keep a
  built-in default price table and don't trust prefix fallback.
- **Two-pass verification catches missed ads.** After cutting pass-1 ads, MinusPod **re-transcribes
  the processed audio** and runs detection again with a "what doesn't belong" prompt. This requires
  mapping processed-audio timestamps back to original-audio coordinates — see §4.

---

## 4. FFmpeg ad-cutting edge cases

Source: `src/audio_processor.py`, `verification_pass.py`, chapter/VAD commits.

- **They re-encode, they don't stream-copy — and it's deliberate.** Cutting at arbitrary timestamps
  with concatenation + fades requires sample-accurate edits, which stream-copy (`-c copy`) cannot do
  (it can only cut on keyframes, causing audible glitches and drift). MinusPod builds a
  `filter_complex` of `atrim` segments + concat and encodes with `libmp3lame` at a configurable
  bitrate. **For HushPod: accept that precise ad removal means re-encoding.** Stream-copy is only
  viable if you cut exactly on frame boundaries and tolerate imprecision — generally not worth it.

- **Crossfades / fades to avoid audible pops at cut points.** Hard cuts pop. MinusPod applies
  `afade=out` (0.5 s) before each cut and `afade=in` (0.8 s, longer ease-back) after, guarded so the
  fade never exceeds the segment length. This is the single most-cited audio-quality detail.

- **They insert a short marker ("beep"/replacement audio), not a silent splice.** Each removed ad is
  replaced by a low-volume (40%) faded marker clip. This signals the listener and avoids jarring
  jump-cuts. Note: an FFmpeg stream can only be consumed once, so to insert N markers you must
  `asplit` the marker input into N copies — a non-obvious filter-graph gotcha. (HushPod can choose
  silent splice instead, but then test cut seams hard.)

- **Merge near-adjacent ads before cutting.** Ads with <1 s gap are merged into one segment
  (`max(end)` handles overlapping/contained detections). Prevents micro-fragments and back-to-back
  fades.

- **Filter out implausibly short "ads" before cutting.** MinusPod refuses to remove detections <10 s
  (and at pattern-creation time requires 15–120 s) — short hits are almost always false positives,
  and cutting them damages content.

- **End-of-episode / post-roll handling is special-cased.** If the last ad leaves <30 s of trailing
  content, MinusPod ends the episode at the marker (drops the residue) rather than leaving a stub of
  post-roll. Also drops <30 s of trailing post-roll content generally.

- **Scale the FFmpeg timeout by duration** (base + ~5 s/min of audio); a fixed timeout killed long
  episodes (`5383a8ac`). Time-cap *every* ffmpeg/ffprobe call and route them through a
  shutdown-aware wrapper — an unbounded `ebur128`/loudnorm pass stalled the pipeline for hours.

- **Capture FFmpeg stderr as raw bytes, not text.** FFmpeg emits non-UTF-8 progress/characters;
  decoding with `errors='replace'` avoids `UnicodeDecodeError` crashes. (Node: read stderr as Buffer.)

- **Verify the output.** After cutting, ffprobe the result and confirm duration dropped by roughly the
  removed time; treat "can't read output" as failure. Keep the original file until the replacement is
  durably written (atomic replace) — partial writes on reprocess corrupted episodes.

- **Two coordinate systems.** The verification pass cuts on *processed-audio* timestamps but the UI/DB
  store *original-audio* timestamps; you must maintain a map between them. **Decide your canonical
  timeline early and convert at the edges**, or you'll cut at the wrong place.

- **VAD gap residue.** After ad removal, untranscribed audio residue (jingles, dead air the LLM never
  saw) can remain; MinusPod added a VAD-based gap detector to trim it — but it false-positived at
  first (`f1f19480`). Audio-only signals are *supporting evidence*, never sufficient on their own.

- **Chapters/metadata.** MinusPod regenerates chapters (Podcasting 2.0 JSON) rather than copying
  upstream ones, because cutting shifts every timestamp; copied chapters would point to the wrong
  places. There were repeated chapter bugs: MIME type (`application/json+chapters`) for Pocket Casts
  compatibility (`b0649c9e`), and a double-adjustment bug when regenerating VTT chapters
  (`873a1e51`). **If you preserve chapters, you must re-time them to the cut audio; if you can't,
  drop them.** Same logic for transcripts (VTT) you serve.

---

## 5. Episode download gotchas

Source: `src/transcriber.py` (`check_audio_availability`, `download_audio`,
`download_audio_with_resume`).

- **CDN redirect chains are long.** Megaphone / Art19 / Simplecast chain 6–8 redirects
  (edge -> regional -> asset); Acast adds analytics bouncers. MinusPod raised `max_redirects` to ~10
  to stop false-failing legitimate feeds. Don't cap redirects at the library default.

- **HEAD-check before download.** Newly published episodes often 404/403 at the CDN because the file
  hasn't propagated yet. A HEAD probe (`check_audio_availability`) classifies 200 (ready),
  404/403 (not ready), 5xx (server error) so you can defer/retry instead of failing the episode.

- **Resume / partial downloads.** `download_audio_with_resume` writes to a deterministic temp path
  (`md5(url)` based), sends `Range: bytes=N-` to resume, and **detects servers that ignore Range**
  (they return 200 with the full file instead of 206) and restart cleanly. On failure it **keeps the
  partial file** for the next attempt.

- **Cap the stream independent of Content-Length.** Chunked responses omit Content-Length, so a
  Content-Length check alone can't stop a disk-fill. MinusPod streams to disk with a hard byte cap
  (500 MB) and also rejects up-front when Content-Length declares >500 MB.

- **Content-type detection for audio.** Use a browser-like UA + `Accept: */*` for audio (some CDNs
  serve differently by UA). Don't assume the enclosure `type` is accurate; validate by probing.

- **Connect vs read timeout split.** Use separate connect (short, ~10 s) and read (long, minutes)
  timeouts; a single timeout either false-fails slow-but-alive CDNs or hangs forever on dead ones.

---

## 6. Serving modified RSS feeds

Source: `src/rss_parser.py` (`modify_feed`, `_emit_channel_*`, `_append_db_episode_item`),
`src/utils/feed_guid.py`, Podcasting 2.0 commits.

- **The episode ID / URL scheme is permanent.** It's embedded in every subscriber's app DB. MinusPod
  documents this in code comments and refuses to change the `md5[:12]` scheme even though SHA-256
  would be "nicer," because changing it re-identifies every episode and looks like the feed vanished.
  **Choose your enclosure URL format and episode-ID scheme once, write it down, and treat it as an
  API contract.**

- **Mint your own `podcast:guid`, don't reuse upstream's.** The served feed is a *different* feed at a
  *different* URL; reusing the origin's GUID makes aggregators conflate the proxy with the origin.
  MinusPod computes a deterministic UUIDv5 over the served feed URL (spec namespace constant, strip
  scheme + single trailing slash). **Equally important: never change the GUID normalization** once
  feeds are live (same re-identification trap). The trailing-slash strip means a BASE_URL config
  change with/without a slash won't silently change feed identity.

- **Channel metadata Apple requires or the feed is silently dropped.** You *must* pass through
  `itunes:author`, `itunes:category`, `itunes:explicit`, `itunes:owner` (plus standard RSS
  copyright/managingEditor/etc.). Without them Apple Podcasts drops the feed from the directory and
  even valid artwork won't render. MinusPod has explicit passthrough allowlists for RSS and iTunes
  channel tags.

- **Strip tags that would lie about the re-cut audio or hijack subscribers:**
  - `itunes:new-feed-url` (would redirect your subscribers back to the origin) — mandatory strip.
  - Podcasting 2.0 `soundbite`, `liveItem`, `alternateEnclosure`, `source`, `integrity` (describe the
    *original* bytes/timeline), `podping` (publishes the feed URL to a public blockchain).
  - iTunes/PC2 ownership verification tokens (`itunes:verify`, `applepodcastsverify`) — bound to the
    original publisher.

- **Enclosure length/type.** MinusPod emits `type="audio/mpeg"` and serves `.mp3`. For processed
  episodes it emits a re-timed `itunes:duration` (the *new*, shorter duration) — stale duration
  confuses scrubbers. Note: MinusPod does *not* emit a byte-accurate enclosure `length` attribute
  (it doesn't know the final size until encode); some strict validators warn on a missing/zero
  `length`. **Decide whether to compute and emit the real byte length after encoding** — if you can,
  do, since some apps use it for the progress bar.

- **Regenerate `<lastBuildDate>` and set `<generator>`** to your own value so apps' refresh detection
  sees fresh values, not stale upstream ones.

- **`<itunes:duration>`/`<itunes:episode>`/`<itunes:explicit>` need validation** — feedparser can hand
  you `None`/empty; emitting `None` as text produces invalid XML. Guard each.

- **Escaping: attributes vs CDATA.** XML-escape titles/links/URLs (ampersands in tracking URLs break
  feeds). Wrap descriptions in `<![CDATA[...]]>` because `content:encoded` carries raw HTML; escaping
  it would double-escape.

- **Cap episode count per feed.** Pocket Casts and others reject very large feeds (>1 MB). MinusPod
  limits to ~300 (max 500) recent episodes, and separately appends processed episodes from the DB
  that fell outside the cap. Cross-reference IDs to avoid emitting an episode twice.

- **Conditional GET correctness (ETag / Last-Modified / 304).** Several subtle bugs here:
  - On a 304, **still update `last_checked_at`**, or every poll re-refreshes (`f99fe2f2`).
  - A **304 with a missing/empty processed-episode cache must regenerate the served feed** anyway,
    or you serve a feed missing already-processed episodes (`15646b6e`).
  - **Force-refresh must bypass both the conditional GET and any refresh-coalescing window**, and must
    *clear* stored ETag/Last-Modified when upstream stops sending them (else a stale validator causes
    a false 304 next time) (`2.5.32`).
  - Coalesce refresh attempts (MinusPod: 30 s window) so a manual refresh + background tick don't
    double-fetch.

- **Don't re-parse the feed N times per refresh.** MinusPod parsed each feed XML three times per cycle
  (parse + extract_episodes + modify_feed each re-parsed). Parse once, thread the parsed object
  through. Minor, but it's pure waste at scale.

---

## 7. Other non-obvious bugs they fixed over time

Grepped from commit messages (`fix`, `crash`, `OOM`, `timeout`, `retry`, `race`, `lock`) and the
CHANGELOG bug-journal.

- **Auto-process race on add-feed** and **cooperative cancel for in-flight processing** (`0d02eec9`):
  adding a feed could kick off processing twice; cancel needed to work for both queued and processing
  states (a queued-cancel returned a misleading 400 for a while). **Design cancel/idempotency into the
  job queue from the start.**
- **SQLite lock contention across workers** (`7b5e8bf0`, `2.5.10`): two Gunicorn workers raced schema
  migrations and DB writes. They serialized migrations with an `flock` file lock and set
  `synchronous=NORMAL` + WAL. **If HushPod uses SQLite, expect write-contention pain under any
  concurrency; use WAL and serialize migrations.** (A single-process Node server avoids much of this.)
- **`INSERT ... ON CONFLICT` rowcount lies.** SQLite reports `rowcount=1` for both insert and update
  branches, so a "discovered N new episodes" counter over-reported by orders of magnitude on force
  refresh (claimed "2697 new" when zero were inserted). Snapshot the existing key set and count real
  new keys (`2.5.32`).
- **`COALESCE(col, 0)` in an UPDATE predicate coerced NULL legacy rows to 0 and overwrote good data**
  — SQL three-valued logic already excludes NULLs from `WHERE`, so the COALESCE was actively harmful
  (`2.5.31`). Be careful "hardening" NULL handling in migrations.
- **Migration that wiped a whole table on partial failure.** A `mode=replace` pattern import committed
  per-row, defeating the route's rollback; a mid-import failure wiped everything. **Run destructive
  imports as a single transaction** (`2.6.0`).
- **Crash from a corrupt audio fingerprint stuck the whole episode** (`d781f776`). Wrap per-episode
  optional features so one bad row can't wedge the pipeline.
- **Timestamp/coordinate double-adjustment** bugs recur (chapters, verification). Any time you have
  two timelines (original vs processed audio), expect off-by-an-offset bugs; write tests that pin the
  mapping.
- **Logging at DEBUG leaked secrets/headers** from HTTP/LLM SDKs into logs (`2.5.22`); they pinned
  third-party loggers to WARNING. **Don't let `httpx`/SDK debug logging dump API keys.** Also redact
  URLs/keys from your own logs (several CodeQL fixes).
- **History/stats undercounts** from two write paths disagreeing on the same number
  (`2.5.28`–`2.5.30`): the cut-count was written one way by the episode-state writer and another by
  the history/webhook writer. **Compute a derived number once and pass it everywhere.**
- **Cross-field validation can be bypassed** via env vars or direct DB writes, so re-validate
  invariants at point-of-use, not just at the API layer (the window overlap>=size hang is the
  cautionary tale).

---

## Top recommendations for HushPod (TypeScript), distilled

1. **Identity is forever.** Lock the episode-ID scheme, enclosure URL format, and `podcast:guid`
   normalization on day one and treat them as an immutable API contract.
2. **Derive episode identity from the RSS GUID, never the enclosure URL** (CDN tracking params).
3. **Parse defensively, in layers.** Use a hardened XML parser (no external entities), fall back
   across description tags, drop to raw XML for channel-vs-item-scoped fields (artwork), and cap body
   size.
4. **Whisper output is noisy.** Filter hallucinations + prompt-echo, pin language, request word
   timestamps (with segment-only fallback), chunk long episodes with overlap + seam-dedup, and
   tolerate partial failure.
5. **Never cut on raw LLM timestamps.** Window the transcript (validate overlap < size), have the LLM
   emit absolute-second timestamps, then snap boundaries to actual transcript keywords and word
   timestamps. Optimize for precision (F0.5) — a wrong cut is worse than a missed ad.
6. **Treat LLM JSON as hostile.** Multi-strategy extraction (direct, code-fence, bracket-depth scan,
   truncation salvage), fuzzy field names, confidence normalization, reasoning-in-sponsor-field
   rejection, degenerate-range rejection. Probe `json_object`/`max_completion_tokens` support per
   provider and cache it. Honor `Retry-After`; don't trip the breaker on 429.
7. **Precise cutting = re-encode with fades.** Apply fade-out/fade-in around every cut, merge
   <1 s-gap ads, drop <10 s detections, special-case end-of-episode, scale ffmpeg timeouts by
   duration, read stderr as bytes, verify output duration, atomic-replace files.
8. **Mind the two timelines.** Pick a canonical audio timeline and convert at the edges; pin the
   original<->processed mapping with tests (verification pass + chapters depend on it).
9. **Downloads: long redirect chains, HEAD-probe-before-download, Range-resume with full-file
   fallback, hard byte cap, split connect/read timeouts, browser UA.**
10. **Served feed must satisfy Apple** (pass through author/category/explicit/owner), strip
    origin-hijacking/verification/original-audio-describing tags, re-time durations/chapters,
    regenerate lastBuildDate, and get conditional-GET/304 caching right (update last-checked on 304,
    regenerate when cache is stale, force-refresh bypasses + clears validators).

> Note: MinusPod is GPL/personal-use and explicitly scoped to podcasts you're permitted to modify;
> these are engineering lessons, not an endorsement to copy code. Re-implement, don't paste.
