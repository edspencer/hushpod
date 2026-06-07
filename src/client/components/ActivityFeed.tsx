import { Link } from 'react-router-dom'
import { Activity } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, Spinner } from '@client/components/ui'
import { useEvents } from '@client/lib/api'
import type { ActivityEvent } from '@client/lib/api'
import { formatBytes, formatMs, relativeTime } from '@client/lib/format'
import { cn } from '@client/lib/cn'

type Tone = 'done' | 'error' | 'finished' | 'muted'

function num(data: Record<string, unknown> | null, key: string): number | undefined {
  const v = data?.[key]
  return typeof v === 'number' ? v : undefined
}

/** Human label + detail + colour tone for an event. */
function describe(e: ActivityEvent): { label: string; detail?: string; tone: Tone } {
  const d = e.data
  switch (e.type) {
    case 'episode.discovered':
      return { label: 'Discovered', tone: 'muted' }
    case 'download.started':
      return { label: 'Downloading…', tone: 'muted' }
    case 'download.finished':
      return { label: 'Downloaded', detail: formatBytes(num(d, 'bytes')), tone: 'finished' }
    case 'transcribe.started':
      return { label: 'Transcribing…', tone: 'muted' }
    case 'transcribe.finished':
      return {
        label: 'Transcribed',
        detail: `${num(d, 'segments') ?? '?'} segments`,
        tone: 'finished',
      }
    case 'detect.started':
      return { label: 'Detecting…', tone: 'muted' }
    case 'detect.finished':
      return { label: 'Detected', detail: `${num(d, 'ads') ?? 0} segments`, tone: 'finished' }
    case 'cut.started':
      return { label: 'Cutting…', tone: 'muted' }
    case 'cut.finished':
      return { label: 'Cut', detail: `${num(d, 'removedSec') ?? 0}s removed`, tone: 'finished' }
    case 'episode.done':
      return { label: 'Finished', tone: 'done' }
    case 'episode.error':
      return {
        label: 'Error',
        detail: typeof d?.message === 'string' ? d.message : undefined,
        tone: 'error',
      }
    default:
      return { label: e.type, tone: 'muted' }
  }
}

const DOT: Record<Tone, string> = {
  done: 'bg-success',
  error: 'bg-danger',
  finished: 'bg-brand-400',
  muted: 'bg-border',
}

export interface ActivityFeedProps {
  limit?: number
  className?: string
}

/** Recent pipeline activity — the persisted companion to the live queue. */
export function ActivityFeed({ limit = 40, className }: ActivityFeedProps) {
  const events = useEvents(limit, 5000)
  const rows = events.data ?? []

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted" />
          Recent activity
        </CardTitle>
        {events.isFetching && <Spinner className="h-3.5 w-3.5" />}
      </CardHeader>
      <CardContent className="p-0">
        {events.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted">
            <Spinner className="h-4 w-4" />
            <span className="text-sm">Loading activity…</span>
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">No activity yet.</p>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {rows.map((e) => {
              const { label, detail, tone } = describe(e)
              return (
                <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm sm:px-5">
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT[tone])} />
                  <span className="shrink-0 font-medium text-fg">{label}</span>
                  {e.durationMs != null && (
                    <span className="shrink-0 text-xs tabular-nums text-muted">
                      {formatMs(e.durationMs)}
                    </span>
                  )}
                  {detail && <span className="shrink-0 text-xs text-muted">· {detail}</span>}
                  <span className="min-w-0 flex-1 truncate text-xs text-muted">
                    {e.showTitle && e.episodeId ? (
                      <Link
                        to={`/episodes/${e.episodeId}`}
                        className="hover:text-fg hover:underline"
                      >
                        {e.showTitle} — {e.episodeTitle}
                      </Link>
                    ) : (
                      (e.showTitle ?? '')
                    )}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted">
                    {relativeTime(e.at)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
