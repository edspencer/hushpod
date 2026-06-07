import { Link } from 'react-router-dom'
import { Podcast, ListMusic, Loader2 } from 'lucide-react'
import { Badge } from '@client/components/ui'
import { cn } from '@client/lib/cn'
import type { Show } from '@client/lib/api'

export interface ShowCardProps {
  show: Show
  /** Whether the pipeline is actively processing work for this show. */
  processing?: boolean
}

export function ShowCard({ show, processing = false }: ShowCardProps) {
  const isProcessing = processing

  return (
    <Link
      to={`/shows/${show.id}`}
      className={cn(
        'group flex flex-col overflow-hidden rounded-lg border border-border bg-surface text-fg shadow-sm transition-colors',
        'hover:border-brand-600/60 hover:bg-surface-2/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
      )}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-surface-2">
        {show.imageUrl ? (
          <img
            src={show.imageUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted">
            <Podcast className="h-10 w-10" />
          </div>
        )}
        <div className="absolute left-2 top-2">
          {show.isActive ? (
            <Badge variant="success">Active</Badge>
          ) : (
            <Badge variant="secondary">Paused</Badge>
          )}
        </div>
        {isProcessing && (
          <div className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white backdrop-blur">
            <Loader2 className="h-3 w-3 animate-spin" />
            Processing
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-fg group-hover:text-brand-300">
          {show.title}
        </h3>
        <div className="mt-auto flex items-center gap-1.5 text-xs text-muted">
          <ListMusic className="h-3.5 w-3.5" />
          <span>
            {show.episodeCount} {show.episodeCount === 1 ? 'episode' : 'episodes'}
          </span>
        </div>
      </div>
    </Link>
  )
}
