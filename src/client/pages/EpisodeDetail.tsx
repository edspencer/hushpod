import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle, Calendar, ChevronDown, ChevronRight, Clock, Download } from 'lucide-react'
import { Button, Card, CardContent, CardHeader, CardTitle, Spinner } from '@client/components/ui'
import { useEpisode } from '@client/lib/api'
import type { EpisodeStatus } from '@client/lib/api'
import { cn } from '@client/lib/cn'
import { EpisodePlayer } from '@client/components/EpisodePlayer'
import { ProcessingStatus } from '@client/components/ProcessingStatus'
import { AdList } from '@client/components/AdList'

const IN_FLIGHT: ReadonlySet<EpisodeStatus> = new Set([
  'pending',
  'downloading',
  'transcribing',
  'detecting',
  'cutting',
])

function fmtDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  const rem = s % 60
  return m > 0 ? `${m}m ${rem}s` : `${rem}s`
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'Unknown date'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Unknown date'
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function EpisodeDetail() {
  const { id } = useParams<{ id: string }>()
  const numericId = id != null && /^\d+$/.test(id) ? Number.parseInt(id, 10) : undefined

  const query = useEpisode(numericId)
  const { data: episode, isLoading, isError, error, refetch } = query

  // Which detected segment the player's head is currently inside (live).
  const [activeAdId, setActiveAdId] = useState<number | null>(null)
  // Playhead position + track, for live transcript highlighting (~1/s).
  const [playhead, setPlayhead] = useState<{ time: number; version: 'clean' | 'original' }>({
    time: 0,
    version: 'clean',
  })

  const inFlight = episode ? IN_FLIGHT.has(episode.status) : false

  // poll while processing is in-flight
  useEffect(() => {
    if (!inFlight) return
    const t = window.setInterval(() => {
      void refetch()
    }, 3000)
    return () => window.clearInterval(t)
  }, [inFlight, refetch])

  if (numericId === undefined) {
    return <EmptyState title="Invalid episode" message="That episode id doesn't look right." />
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted">
        <Spinner className="h-5 w-5" />
        <span className="text-sm">Loading episode…</span>
      </div>
    )
  }

  if (isError || !episode) {
    return (
      <EmptyState
        title="Could not load episode"
        message={error?.message ?? 'The episode may not exist.'}
        action={
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        }
      />
    )
  }

  const notProcessed = episode.status === 'pending' && episode.ads.length === 0

  return (
    <div className="space-y-6">
      {/* breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1 text-sm text-muted">
        <Link to="/" className="hover:text-fg">
          Dashboard
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        {episode.showTitle ? (
          <Link to={`/shows/${episode.showId}`} className="text-brand-400 hover:underline">
            {episode.showTitle}
          </Link>
        ) : (
          <Link to={`/shows/${episode.showId}`} className="hover:text-fg">
            Show #{episode.showId}
          </Link>
        )}
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="truncate text-fg">{episode.title}</span>
      </nav>

      {/* header */}
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold leading-tight text-fg">{episode.title}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="h-4 w-4" />
            {fmtDate(episode.publishedAt)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-4 w-4" />
            {fmtDuration(episode.duration)}
          </span>
        </div>
        {episode.description && <EpisodeDescription text={episode.description} />}
      </header>

      <ProcessingStatus
        episodeId={episode.id}
        status={episode.status}
        errorMessage={episode.errorMessage}
        retryCount={episode.retryCount}
      />

      {notProcessed ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <AlertCircle className="h-8 w-8 text-muted" />
            <p className="text-sm font-medium text-fg">
              This episode hasn&apos;t been processed yet
            </p>
            <p className="max-w-md text-sm text-muted">
              Click <span className="font-medium text-fg">Process</span> above to download,
              transcribe, and remove ads. The player and detected segments will appear once
              processing completes.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <EpisodePlayer
            episodeId={episode.id}
            cleanUrl={episode.audioCleanUrl}
            originalUrl={episode.audioOriginalUrl}
            fallbackDuration={episode.duration}
            ads={episode.ads}
            onActiveAdChange={setActiveAdId}
            onProgress={(time, version) => setPlayhead({ time, version })}
          />

          <DownloadBar cleanUrl={episode.audioCleanUrl} originalUrl={episode.audioOriginalUrl} />

          <AdList
            ads={episode.ads}
            originalDuration={episode.duration}
            episodeId={episode.id}
            hasTranscript={episode.hasTranscript}
            activeAdId={activeAdId}
            currentTime={playhead.version === 'original' ? playhead.time : null}
          />
        </>
      )}
    </div>
  )
}

function EpisodeDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const [clampable, setClampable] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)

  // Detect whether the (clamped) description actually overflows, so the toggle
  // only appears when there's more to show. Re-checks on width changes.
  useEffect(() => {
    const el = ref.current
    if (!el || expanded) return
    const check = () => setClampable(el.scrollHeight > el.clientHeight + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text, expanded])

  return (
    <div className="space-y-1">
      <p
        ref={ref}
        className={cn('font-serif text-[15px] leading-7 text-fg/85', !expanded && 'line-clamp-5')}
      >
        {text}
      </p>
      {clampable && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-400 hover:underline"
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'Show more'}
          <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
        </button>
      )}
    </div>
  )
}

function DownloadBar({
  cleanUrl,
  originalUrl,
}: {
  cleanUrl: string | null
  originalUrl: string | null
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <DownloadLink href={cleanUrl} label="Download clean" filename="clean.mp3" primary />
      <DownloadLink href={originalUrl} label="Download original" filename="original.mp3" />
    </div>
  )
}

function DownloadLink({
  href,
  label,
  filename,
  primary = false,
}: {
  href: string | null
  label: string
  filename: string
  primary?: boolean
}) {
  const base =
    'inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors'
  if (!href) {
    return (
      <span
        className={cn(
          base,
          'cursor-not-allowed border border-border bg-transparent text-muted opacity-50',
        )}
        aria-disabled="true"
      >
        <Download className="h-4 w-4" />
        {label}
      </span>
    )
  }
  return (
    <a
      href={href}
      download={filename}
      className={cn(
        base,
        primary
          ? 'bg-brand-600 text-white hover:bg-brand-500'
          : 'border border-border bg-transparent text-fg hover:bg-surface-2',
      )}
    >
      <Download className="h-4 w-4" />
      {label}
    </a>
  )
}

function EmptyState({
  title,
  message,
  action,
}: {
  title: string
  message: string
  action?: React.ReactNode
}) {
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-muted" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted">{message}</p>
        <div className="flex items-center gap-2">
          <Link to="/" className="text-sm font-medium text-brand-400 hover:underline">
            Back to dashboard
          </Link>
          {action}
        </div>
      </CardContent>
    </Card>
  )
}
