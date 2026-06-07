import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ChevronRight, Inbox, Megaphone } from 'lucide-react'
import { Card, StatusBadge } from '@client/components/ui'
import { SegmentTimeline } from '@client/components/SegmentTimeline'
import type { Ad, Episode } from '@client/lib/api'
import { cn } from '@client/lib/cn'

export interface EpisodeListProps {
  episodes: Episode[]
  /** Optional ads for the whole show, used for per-episode counts + timelines. */
  ads?: Ad[]
  className?: string
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function sortEpisodes(episodes: Episode[]): Episode[] {
  return [...episodes].sort((a, b) => {
    const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0
    const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0
    if (tb !== ta) return tb - ta
    return b.id - a.id
  })
}

export function EpisodeList({ episodes, ads, className }: EpisodeListProps) {
  const sorted = useMemo(() => sortEpisodes(episodes), [episodes])

  const adsByEpisode = useMemo(() => {
    const map = new Map<number, Ad[]>()
    for (const ad of ads ?? []) {
      const list = map.get(ad.episodeId)
      if (list) list.push(ad)
      else map.set(ad.episodeId, [ad])
    }
    return map
  }, [ads])

  if (sorted.length === 0) {
    return (
      <Card
        className={cn(
          'flex flex-col items-center justify-center gap-2 p-10 text-center',
          className,
        )}
      >
        <Inbox className="h-8 w-8 text-muted" />
        <p className="text-sm font-medium text-fg">No episodes yet</p>
        <p className="text-xs text-muted">Check for new episodes to start processing this show.</p>
      </Card>
    )
  }

  return (
    <Card className={cn('divide-y divide-border overflow-hidden', className)}>
      {sorted.map((ep) => {
        const epAds = adsByEpisode.get(ep.id) ?? []
        return (
          <Link
            key={ep.id}
            to={`/episodes/${ep.id}`}
            className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60"
          >
            <div className="min-w-0 flex-1">
              {/* line 1 — title (gets the full row width) */}
              <div
                className="truncate text-sm font-medium text-fg group-hover:text-brand-400"
                title={ep.title}
              >
                {ep.title}
              </div>

              {/* line 2 — meta + inline segment timeline */}
              <div className="mt-1 flex items-center gap-3 text-xs text-muted">
                <span className="whitespace-nowrap">{formatDate(ep.publishedAt)}</span>
                <span className="whitespace-nowrap tabular-nums">
                  {formatDuration(ep.duration)}
                </span>
                {epAds.length > 0 && (
                  <span className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums">
                    <Megaphone className="h-3 w-3" />
                    {epAds.length}
                  </span>
                )}
                <SegmentTimeline
                  ads={epAds}
                  duration={ep.duration}
                  className="ml-auto w-32 shrink-0 sm:w-48 md:w-64"
                />
              </div>

              {/* error detail */}
              {ep.status === 'error' && ep.errorMessage && (
                <div className="mt-1 flex items-center gap-1 text-xs text-danger">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  <span className="truncate">{ep.errorMessage}</span>
                  {ep.retryCount > 0 && <span className="text-muted">(retry {ep.retryCount})</span>}
                </div>
              )}
            </div>

            <StatusBadge status={ep.status} className="shrink-0" />
            <ChevronRight className="h-4 w-4 shrink-0 text-muted transition-colors group-hover:text-fg" />
          </Link>
        )
      })}
    </Card>
  )
}
