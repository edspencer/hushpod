import { AlertTriangle, Clock, Download, FileAudio, ScanSearch, Scissors } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@client/components/ui'
import type { StageTelemetry, Telemetry, TelemetryStage } from '@client/lib/api'
import { formatBytes, formatMs } from '@client/lib/format'
import { cn } from '@client/lib/cn'

const STAGES: {
  key: TelemetryStage
  label: string
  icon: typeof Download
  bar: string
  fg: string
  facts: (t: StageTelemetry) => string | null
}[] = [
  {
    key: 'download',
    label: 'Download',
    icon: Download,
    bar: 'bg-info',
    fg: 'text-info',
    facts: (t) => (t.bytes ? formatBytes(t.bytes) : null),
  },
  {
    key: 'transcribe',
    label: 'Transcribe',
    icon: FileAudio,
    bar: 'bg-brand-500',
    fg: 'text-brand-300',
    facts: (t) =>
      t.segments != null ? `${t.segments} segments${t.model ? ` · ${t.model}` : ''}` : null,
  },
  {
    key: 'detect',
    label: 'Detect',
    icon: ScanSearch,
    bar: 'bg-warning',
    fg: 'text-warning',
    facts: (t) => (t.ads != null ? `${t.ads} segment${t.ads === 1 ? '' : 's'} found` : null),
  },
  {
    key: 'cut',
    label: 'Cut',
    icon: Scissors,
    bar: 'bg-success',
    fg: 'text-success',
    facts: (t) => (t.removedSec != null ? `${t.removedSec}s removed` : null),
  },
]

export interface EpisodeTimelineProps {
  telemetry: Telemetry
  className?: string
}

/** Per-episode pipeline timing, folded from the event log. Shows each stage's
 * duration (with a proportional bar) and the facts it recorded. */
export function EpisodeTimeline({ telemetry, className }: EpisodeTimelineProps) {
  const rows = STAGES.map((s) => ({ ...s, t: telemetry.stages[s.key] })).filter(
    (s) => s.t?.ms != null,
  )
  const total = telemetry.totalMs ?? rows.reduce((a, s) => a + (s.t!.ms ?? 0), 0)

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted" />
          Pipeline timing
        </CardTitle>
        {rows.length > 0 && (
          <span className="text-xs text-muted">
            total <span className="font-medium text-fg tabular-nums">{formatMs(total)}</span>
          </span>
        )}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">
            No stage timing was recorded for this episode (it predates telemetry, or hasn’t
            processed yet).
          </p>
        ) : (
          <div className="space-y-4">
            {/* Proportional bar across stages. */}
            <div className="flex h-2 overflow-hidden rounded-full bg-surface-2">
              {rows.map((s) => (
                <div
                  key={s.key}
                  className={s.bar}
                  style={{ width: `${total > 0 ? ((s.t!.ms ?? 0) / total) * 100 : 0}%` }}
                  title={`${s.label}: ${formatMs(s.t!.ms)}`}
                />
              ))}
            </div>

            <div className="space-y-2.5">
              {rows.map((s) => {
                const facts = s.facts(s.t!)
                return (
                  <div key={s.key} className="flex items-center gap-3 text-sm">
                    <s.icon className={cn('h-4 w-4 shrink-0', s.fg)} />
                    <span className="w-20 shrink-0 font-medium text-fg">{s.label}</span>
                    <span className="shrink-0 tabular-nums text-muted">{formatMs(s.t!.ms)}</span>
                    {facts && <span className="truncate text-xs text-muted">· {facts}</span>}
                  </div>
                )
              })}
            </div>

            {telemetry.attempts != null && telemetry.attempts > 1 && (
              <p className="text-xs text-muted">
                {telemetry.attempts} processing attempts (reprocessed).
              </p>
            )}
            {telemetry.lastError && (
              <p className="flex items-start gap-1.5 text-xs text-danger">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Last error{telemetry.lastError.stage ? ` (${telemetry.lastError.stage})` : ''}:{' '}
                {telemetry.lastError.message}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
