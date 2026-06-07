import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ChevronRight, Inbox, Megaphone } from 'lucide-react'
import { Badge, Card, StatusBadge } from '@client/components/ui'
import type { Ad, Episode } from '@client/lib/api'
import { cn } from '@client/lib/cn'

export interface EpisodeListProps {
  episodes: Episode[]
  /** Optional ads for the whole show, used to display per-episode ad counts. */
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
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
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

  const adCounts = useMemo(() => {
    const map = new Map<number, number>()
    for (const ad of ads ?? []) {
      map.set(ad.episodeId, (map.get(ad.episodeId) ?? 0) + 1)
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
    <Card className={cn('overflow-hidden', className)}>
      {/* Desktop table */}
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-4 py-2.5 font-medium">Episode</th>
              <th className="px-4 py-2.5 font-medium">Published</th>
              <th className="px-4 py-2.5 font-medium">Duration</th>
              <th className="px-4 py-2.5 font-medium">Ads</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5" aria-label="Open" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((ep) => {
              const count = adCounts.get(ep.id) ?? 0
              return (
                <tr
                  key={ep.id}
                  className="group border-b border-border last:border-0 transition-colors hover:bg-surface-2/60"
                >
                  <td className="max-w-0 px-4 py-3">
                    <Link
                      to={`/episodes/${ep.id}`}
                      className="block truncate font-medium text-fg group-hover:text-brand-400"
                      title={ep.title}
                    >
                      {ep.title}
                    </Link>
                    {ep.status === 'error' && ep.errorMessage && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-danger">
                        <AlertCircle className="h-3 w-3 shrink-0" />
                        <span className="truncate">{ep.errorMessage}</span>
                        {ep.retryCount > 0 && (
                          <span className="text-muted">(retry {ep.retryCount})</span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">
                    {formatDate(ep.publishedAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted tabular-nums">
                    {formatDuration(ep.duration)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">
                    {count > 0 ? (
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Megaphone className="h-3.5 w-3.5" />
                        {count}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={ep.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/episodes/${ep.id}`}
                      aria-label={`Open ${ep.title}`}
                      className="inline-flex text-muted transition-colors hover:text-fg"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="divide-y divide-border md:hidden">
        {sorted.map((ep) => {
          const count = adCounts.get(ep.id) ?? 0
          return (
            <li key={ep.id}>
              <Link
                to={`/episodes/${ep.id}`}
                className="flex flex-col gap-2 p-4 transition-colors hover:bg-surface-2/60"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-fg">{ep.title}</span>
                  <StatusBadge status={ep.status} />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <span>{formatDate(ep.publishedAt)}</span>
                  <span className="tabular-nums">{formatDuration(ep.duration)}</span>
                  {count > 0 && (
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Megaphone className="h-3 w-3" />
                      {count} ads
                    </span>
                  )}
                </div>
                {ep.status === 'error' && ep.errorMessage && (
                  <Badge variant="danger" className="self-start">
                    <AlertCircle className="h-3 w-3" />
                    {ep.errorMessage}
                  </Badge>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
