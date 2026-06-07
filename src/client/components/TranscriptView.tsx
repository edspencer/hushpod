import { useEffect, useMemo, useRef } from 'react'
import type { Ad, AdLabel, Transcript } from '@client/lib/api'
import { cn } from '@client/lib/cn'

// Subtle background tints (readable behind text), matching the label palette.
const LABEL_TINT: Record<AdLabel, string> = {
  ad: 'bg-danger/15',
  promo: 'bg-warning/15',
  fluff: 'bg-info/15',
}
const LABEL_TEXT: Record<AdLabel, string> = {
  ad: 'Ad',
  promo: 'Promo',
  fluff: 'Fluff',
}
const CHIP: Record<AdLabel, string> = {
  ad: 'bg-danger/25 text-danger',
  promo: 'bg-warning/25 text-warning',
  fluff: 'bg-info/25 text-info',
}

export interface TranscriptViewProps {
  transcript: Transcript
  ads: Ad[]
  /** Playhead position on the ORIGINAL timeline (or null if not applicable). */
  currentTime?: number | null
  className?: string
}

/** The episode transcript rendered as a continuous read, with detected
 * ad/promo/fluff spans highlighted in place and the segment under the
 * playhead emphasized. Lets you eyeball whether the classifier got it right. */
export function TranscriptView({ transcript, ads, currentTime, className }: TranscriptViewProps) {
  const segments = transcript.segments

  // For each transcript segment, the label of the detected ad that covers it
  // (by time overlap), or null for editorial content.
  const labelOf = useMemo(() => {
    const sorted = [...ads].sort((a, b) => a.startTime - b.startTime)
    return segments.map((s) => {
      const mid = (s.start + s.end) / 2
      const hit = sorted.find((a) => mid >= a.startTime && mid < a.endTime)
      return hit ? hit.label : null
    })
  }, [segments, ads])

  const activeIndex = useMemo(() => {
    if (currentTime == null) return -1
    return segments.findIndex((s) => currentTime >= s.start && currentTime < s.end)
  }, [segments, currentTime])

  const activeRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (activeIndex >= 0)
      activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIndex])

  if (segments.length === 0) {
    return <p className="text-sm text-muted">Transcript is empty.</p>
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span>Highlighted = removed:</span>
        {(['ad', 'promo', 'fluff'] as AdLabel[]).map((l) => (
          <span key={l} className="inline-flex items-center gap-1">
            <span className={cn('inline-block h-2.5 w-2.5 rounded-sm', LABEL_TINT[l])} />
            {LABEL_TEXT[l]}
          </span>
        ))}
      </div>

      <div className="max-h-[28rem] overflow-y-auto rounded-md border border-border bg-surface-2/30 p-3 font-serif text-[15px] leading-7">
        {segments.map((seg, i) => {
          const label = labelOf[i]
          const prevLabel = i > 0 ? labelOf[i - 1] : null
          const isRunStart = label != null && label !== prevLabel
          const isActive = i === activeIndex
          return (
            <span key={seg.id} ref={isActive ? activeRef : undefined}>
              {isRunStart && (
                <span
                  className={cn(
                    'mr-1 rounded px-1 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide',
                    CHIP[label],
                  )}
                >
                  {LABEL_TEXT[label]}
                </span>
              )}
              <span
                className={cn(
                  'rounded px-0.5',
                  label && LABEL_TINT[label],
                  isActive && 'bg-brand-500/30 text-fg ring-1 ring-brand-400',
                  !label && !isActive && 'text-fg/80',
                )}
              >
                {seg.text}
              </span>{' '}
            </span>
          )
        })}
      </div>
    </div>
  )
}
