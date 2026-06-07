import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Badge, Card, StatusBadge } from '@client/components/ui'
import type { QueueItem, QueueStage } from '@client/lib/api'
import { cn } from '@client/lib/cn'

export interface QueueTableProps {
  items: QueueItem[]
  className?: string
}

const STAGE_LABEL: Record<QueueStage, string> = {
  download: 'download',
  transcribe: 'transcribe',
  detect: 'detect',
}

/** What an episode is doing or waiting for: the live status when it's actively
 * being worked, otherwise which stage it's queued for. */
function QueueStatus({ item }: { item: QueueItem }) {
  if (item.state === 'active') return <StatusBadge status={item.status} />
  return <Badge variant="secondary">Queued · {STAGE_LABEL[item.stage]}</Badge>
}

/** The processing queue as an ordered table: what's running now (top) and what's
 * waiting behind it. Shown on the dashboard when the queue toggle is expanded. */
export function QueueTable({ items, className }: QueueTableProps) {
  if (items.length === 0) {
    return (
      <Card className={cn('p-4', className)}>
        <p className="text-sm text-muted">The queue is empty — nothing is waiting to process.</p>
      </Card>
    )
  }

  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="w-10 px-4 py-2.5 font-medium sm:px-5">#</th>
              <th className="px-4 py-2.5 font-medium">Show</th>
              <th className="px-4 py-2.5 font-medium">Episode</th>
              <th className="px-4 py-2.5 font-medium sm:px-5">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const active = item.state === 'active'
              return (
                <tr
                  key={item.id}
                  className={cn('border-b border-border last:border-0', active && 'bg-brand-500/5')}
                >
                  <td className="px-4 py-2.5 text-muted tabular-nums sm:px-5">
                    {active ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-400" />
                    ) : (
                      i + 1
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/shows/${item.showId}`}
                      className="font-medium text-fg hover:text-brand-400 hover:underline"
                    >
                      {item.showTitle}
                    </Link>
                  </td>
                  <td className="max-w-xs px-4 py-2.5">
                    <Link
                      to={`/episodes/${item.id}`}
                      className="block truncate text-muted hover:text-fg hover:underline"
                      title={item.title}
                    >
                      {item.title}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 sm:px-5">
                    <QueueStatus item={item} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
