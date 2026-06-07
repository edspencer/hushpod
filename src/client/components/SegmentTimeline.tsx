import type { Ad, AdLabel } from '@client/lib/api'
import { cn } from '@client/lib/cn'

// Same palette as the episode player's scrub-bar markers.
const LABEL_COLOR: Record<AdLabel, string> = {
  ad: 'bg-danger/70',
  fluff: 'bg-info/70',
}

function mmss(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0
  const t = Math.floor(s)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

export interface SegmentTimelineProps {
  ads: Ad[]
  duration: number | null
  className?: string
}

/** A compact bar showing where detected ad segments sit across an episode's
 * original timeline — a miniature of the player's scrub-bar markers. */
export function SegmentTimeline({ ads, duration, className }: SegmentTimelineProps) {
  const hasDuration = duration != null && Number.isFinite(duration) && duration > 0
  return (
    <div
      className={cn('relative h-1.5 overflow-hidden rounded-full bg-surface-2', className)}
      role="img"
      aria-label={hasDuration && ads.length ? `${ads.length} detected segments` : 'no segments'}
    >
      {hasDuration &&
        ads.map((ad) => {
          const left = Math.max(0, Math.min(100, (ad.startTime / duration) * 100))
          const width = Math.max(0.8, ((ad.endTime - ad.startTime) / duration) * 100)
          return (
            <span
              key={ad.id}
              className={cn('absolute inset-y-0', LABEL_COLOR[ad.label])}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${ad.company ?? ad.label} · ${mmss(ad.startTime)}–${mmss(ad.endTime)}`}
            />
          )
        })}
    </div>
  )
}
