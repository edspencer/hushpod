import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, RotateCcw, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@client/components/ui'
import type { Ad, AdLabel } from '@client/lib/api'
import * as playback from '@client/lib/playback'
import type { PlaybackState } from '@client/lib/playback'
import { cn } from '@client/lib/cn'

type Version = 'clean' | 'original'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
const SAVE_THROTTLE_MS = 2000

const MARKER_COLOR: Record<AdLabel, string> = {
  ad: 'bg-danger/70',
  promo: 'bg-warning/70',
  fluff: 'bg-info/70',
}

function fmtTime(total: number): string {
  if (!Number.isFinite(total) || total < 0) total = 0
  const t = Math.floor(total)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export interface EpisodePlayerProps {
  episodeId: number
  cleanUrl: string | null
  originalUrl: string | null
  /** fallback total duration (seconds) until the audio reports its own */
  fallbackDuration: number | null
  ads: Ad[]
  /** Notified when the segment under the playhead changes (null when none, or
   * when playing the clean track where ads no longer exist). */
  onActiveAdChange?: (adId: number | null) => void
  /** Playhead position (throttled to ~1/s) + which track is playing. Used to
   * sync the transcript view. */
  onProgress?: (timeSec: number, version: Version) => void
  className?: string
}

export function EpisodePlayer({
  episodeId,
  cleanUrl,
  originalUrl,
  fallbackDuration,
  ads,
  onActiveAdChange,
  onProgress,
  className,
}: EpisodePlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const lastSaveRef = useRef(0)
  const lastEmitRef = useRef(-1)
  const restoredRef = useRef<PlaybackState | null>(null)

  // pick the initial version from saved state, falling back to whatever exists
  const [version, setVersion] = useState<Version>(() => {
    const saved = playback.load(episodeId)
    if (saved?.version === 'clean' && cleanUrl) return 'clean'
    if (saved?.version === 'original' && originalUrl) return 'original'
    return cleanUrl ? 'clean' : 'original'
  })
  const [speed, setSpeed] = useState<number>(() => {
    const saved = playback.load(episodeId)
    return saved && SPEEDS.includes(saved.speed as (typeof SPEEDS)[number]) ? saved.speed : 1
  })
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(fallbackDuration ?? 0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)

  const src = version === 'clean' ? cleanUrl : originalUrl
  const noAudio = !cleanUrl && !originalUrl
  const effectiveDuration =
    Number.isFinite(duration) && duration > 0 ? duration : (fallbackDuration ?? 0)

  // restore persisted state once metadata is available
  useEffect(() => {
    restoredRef.current = playback.load(episodeId)
  }, [episodeId])

  // apply playbackRate whenever speed or src changes
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [speed, src])

  // apply volume / mute
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume
      audioRef.current.muted = muted
    }
  }, [volume, muted])

  const persist = useCallback(
    (force = false) => {
      const audio = audioRef.current
      if (!audio) return
      const now = Date.now()
      if (!force && now - lastSaveRef.current < SAVE_THROTTLE_MS) return
      lastSaveRef.current = now
      playback.save(episodeId, {
        position: audio.currentTime,
        speed,
        version,
        updatedAt: now,
      })
    },
    [episodeId, speed, version],
  )

  const handleLoadedMetadata = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration)
    }
    audio.playbackRate = speed
    // restore saved position only for the matching version
    const saved = restoredRef.current
    if (saved && saved.version === version && saved.position > 0) {
      const clamped = Math.min(saved.position, (audio.duration || saved.position) - 0.25)
      if (clamped > 0) {
        audio.currentTime = clamped
        setCurrent(clamped)
      }
      restoredRef.current = null
    }
  }, [speed, version])

  // Emit the playhead to the parent at most once per second (cheap enough to
  // drive transcript highlighting without re-rendering the page every frame).
  const emitProgress = useCallback(
    (t: number) => {
      const sec = Math.floor(t)
      if (onProgress && sec !== lastEmitRef.current) {
        lastEmitRef.current = sec
        onProgress(t, version)
      }
    },
    [onProgress, version],
  )

  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    setCurrent(audio.currentTime)
    emitProgress(audio.currentTime)
    if (!audio.paused) persist()
  }, [persist, emitProgress])

  const handleEnded = useCallback(() => {
    setPlaying(false)
    setCurrent(0)
    playback.clear(episodeId)
    lastSaveRef.current = 0
  }, [episodeId])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !src) return
    if (audio.paused) {
      void audio.play().catch(() => setPlaying(false))
    } else {
      audio.pause()
      persist(true)
    }
  }, [src, persist])

  const seekTo = useCallback(
    (t: number) => {
      const audio = audioRef.current
      if (!audio) return
      const clamped = Math.max(0, Math.min(t, effectiveDuration || t))
      audio.currentTime = clamped
      setCurrent(clamped)
      lastEmitRef.current = -1
      emitProgress(clamped)
      persist(true)
    },
    [effectiveDuration, persist, emitProgress],
  )

  const skip = useCallback(
    (delta: number) => seekTo((audioRef.current?.currentTime ?? 0) + delta),
    [seekTo],
  )

  function switchVersion(next: Version) {
    if (next === version) return
    const url = next === 'clean' ? cleanUrl : originalUrl
    if (!url) return
    persist(true)
    setVersion(next)
    setCurrent(0)
    setPlaying(false)
    // a fresh load() so the next loadedmetadata can restore the matching pos
    restoredRef.current = playback.load(episodeId)
  }

  // keyboard: space to play/pause when player container focused
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        skip(-10)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        skip(10)
      }
    },
    [togglePlay, skip],
  )

  const showMarkers = version === 'original' && ads.length > 0
  const progressPct = effectiveDuration > 0 ? (current / effectiveDuration) * 100 : 0

  // The ad segment under the playhead. Ad timestamps are on the original
  // timeline, so this only applies while the original track is active.
  const activeAdId = useMemo(() => {
    if (version !== 'original') return null
    const hit = ads.find((a) => current >= a.startTime && current < a.endTime)
    return hit ? hit.id : null
  }, [version, current, ads])

  // Notify the parent only when the active segment actually changes.
  useEffect(() => {
    onActiveAdChange?.(activeAdId)
  }, [activeAdId, onActiveAdChange])

  // Clear any highlight when this player unmounts.
  useEffect(() => () => onActiveAdChange?.(null), [onActiveAdChange])

  if (noAudio) {
    return (
      <div
        className={cn(
          'rounded-lg border border-dashed border-border bg-surface p-6 text-center',
          className,
        )}
      >
        <p className="text-sm text-muted">
          No audio available yet. Run processing to generate the cleaned episode.
        </p>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-surface p-4 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:p-5',
        className,
      )}
      tabIndex={0}
      role="group"
      aria-label="Audio player"
      onKeyDown={onKeyDown}
    >
      {src && (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={handleEnded}
        />
      )}

      {/* version toggle */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="inline-flex rounded-md border border-border bg-surface-2 p-0.5">
          <button
            type="button"
            onClick={() => switchVersion('clean')}
            disabled={!cleanUrl}
            className={cn(
              'rounded px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              version === 'clean' ? 'bg-brand-600 text-white' : 'text-muted hover:text-fg',
            )}
            aria-pressed={version === 'clean'}
          >
            Clean
          </button>
          <button
            type="button"
            onClick={() => switchVersion('original')}
            disabled={!originalUrl}
            className={cn(
              'rounded px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              version === 'original' ? 'bg-brand-600 text-white' : 'text-muted hover:text-fg',
            )}
            aria-pressed={version === 'original'}
          >
            Original
          </button>
        </div>
        <span className="text-xs text-muted">
          {version === 'clean'
            ? 'Ads removed'
            : `Original · ${ads.length} segment${ads.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {/* scrub bar with ad markers */}
      <div className="relative mb-1.5">
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-brand-500"
            style={{ width: `${progressPct}%` }}
          />
          {showMarkers &&
            effectiveDuration > 0 &&
            ads.map((ad) => {
              const left = (ad.startTime / effectiveDuration) * 100
              const width = Math.max(0.5, ((ad.endTime - ad.startTime) / effectiveDuration) * 100)
              const isActive = ad.id === activeAdId
              return (
                <div
                  key={ad.id}
                  className={cn(
                    'absolute inset-y-0 z-10 transition-[filter,opacity]',
                    MARKER_COLOR[ad.label],
                    isActive
                      ? 'opacity-100 brightness-150 outline outline-1 outline-white/90'
                      : 'opacity-100',
                  )}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${ad.company ?? 'Unknown'} · ${ad.label} (${fmtTime(
                    ad.startTime,
                  )}–${fmtTime(ad.endTime)})`}
                />
              )
            })}
        </div>
        <input
          type="range"
          min={0}
          max={effectiveDuration || 0}
          step={0.1}
          value={Math.min(current, effectiveDuration || current)}
          onChange={(e) => seekTo(Number(e.target.value))}
          aria-label="Seek"
          disabled={!src}
          className="absolute inset-0 z-20 h-2 w-full cursor-pointer appearance-none bg-transparent [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow"
        />
      </div>

      <div className="mb-3 flex justify-between font-mono text-xs text-muted">
        <span>{fmtTime(current)}</span>
        <span>{fmtTime(effectiveDuration)}</span>
      </div>

      {/* transport + controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => skip(-10)}
            disabled={!src}
            aria-label="Back 10 seconds"
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            onClick={togglePlay}
            disabled={!src}
            aria-label={playing ? 'Pause' : 'Play'}
            className="h-11 w-11 rounded-full"
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => skip(30)}
            disabled={!src}
            aria-label="Forward 30 seconds"
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>

        {/* speed */}
        <div className="flex items-center gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              aria-pressed={speed === s}
              className={cn(
                'rounded px-1.5 py-1 text-xs font-medium tabular-nums transition-colors',
                speed === s ? 'bg-surface-2 text-brand-300' : 'text-muted hover:text-fg',
              )}
            >
              {s}×
            </button>
          ))}
        </div>

        {/* volume */}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted || volume === 0 ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </Button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => {
              const v = Number(e.target.value)
              setVolume(v)
              setMuted(v === 0)
            }}
            aria-label="Volume"
            className="h-1.5 w-20 cursor-pointer appearance-none rounded-full bg-surface-2 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-fg [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-fg"
          />
        </div>
      </div>

      {/* marker legend (only relevant on original) */}
      {showMarkers && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1">
            <RotateCcw className="h-3 w-3" /> Markers show removed segments on the original timeline
          </span>
        </div>
      )}
    </div>
  )
}
