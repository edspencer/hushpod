import { Check, Loader2, Workflow, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, StatusBadge } from '@client/components/ui'
import type { EpisodeStatus, Telemetry, TelemetryStage } from '@client/lib/api'
import { formatBytes, formatMs, formatUsd } from '@client/lib/format'
import { cn } from '@client/lib/cn'

const STEPS: { key: EpisodeStatus; label: string; stage: TelemetryStage | null }[] = [
  { key: 'pending', label: 'Pending', stage: null },
  { key: 'downloading', label: 'Download', stage: 'download' },
  { key: 'transcribing', label: 'Transcribe', stage: 'transcribe' },
  { key: 'detecting', label: 'Detect', stage: 'detect' },
  { key: 'cutting', label: 'Cut', stage: 'cut' },
  { key: 'done', label: 'Done', stage: null },
]

const IN_FLIGHT: ReadonlySet<EpisodeStatus> = new Set([
  'pending',
  'downloading',
  'transcribing',
  'detecting',
  'cutting',
])

/** Timing plus a stage-specific second line (download size, detect cost, total
 * cost) to show under a step — from telemetry. */
function stepFacts(
  step: (typeof STEPS)[number],
  telemetry: Telemetry,
): { dur: string | null; sub: string | null } {
  if (step.key === 'done') {
    return {
      dur: telemetry.totalMs != null ? formatMs(telemetry.totalMs) : null,
      sub: telemetry.costUsd ? formatUsd(telemetry.costUsd) : null,
    }
  }
  const st = step.stage ? telemetry.stages[step.stage] : undefined
  let sub: string | null = null
  if (step.stage === 'download' && st?.bytes != null) sub = formatBytes(st.bytes)
  else if (step.stage === 'detect' && st?.costUsd) sub = formatUsd(st.costUsd)
  return { dur: st?.ms != null ? formatMs(st.ms) : null, sub }
}

export interface PipelineStepperProps {
  status: EpisodeStatus
  telemetry: Telemetry
  className?: string
}

/** The pipeline as six steps (pending → done), each circle annotated with the
 * stage's duration and — for detect — its estimated cost. */
export function PipelineStepper({ status, telemetry, className }: PipelineStepperProps) {
  const isDone = status === 'done'
  const inFlight = IN_FLIGHT.has(status)
  const failedStage = status === 'error' ? telemetry.lastError?.stage : undefined

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Workflow className="h-4 w-4 text-muted" />
          Processing pipeline
        </CardTitle>
        <StatusBadge status={status} />
      </CardHeader>
      <CardContent>
        <ol className="flex items-start">
          {STEPS.map((step, i) => {
            const complete = step.stage
              ? telemetry.stages[step.stage]?.ms != null
              : step.key === 'pending'
                ? status !== 'pending'
                : isDone
            const active = status === step.key && inFlight
            const failed = step.stage != null && failedStage === step.stage
            const last = i === STEPS.length - 1
            const { dur, sub } = stepFacts(step, telemetry)
            return (
              <li key={step.key} className={cn('flex items-start', !last && 'flex-1')}>
                <div className="flex w-full flex-col items-center gap-1.5">
                  <div
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                      failed
                        ? 'border-danger bg-danger/15 text-danger'
                        : complete
                          ? 'border-brand-500 bg-brand-600 text-white'
                          : active
                            ? 'border-brand-500 bg-brand-500/15 text-brand-300'
                            : 'border-border bg-surface-2 text-muted',
                    )}
                  >
                    {failed ? (
                      <X className="h-4 w-4" />
                    ) : complete ? (
                      <Check className="h-4 w-4" />
                    ) : active ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      i + 1
                    )}
                  </div>
                  <span
                    className={cn(
                      'hidden text-[11px] sm:block',
                      complete || active ? 'text-fg' : 'text-muted',
                    )}
                  >
                    {step.label}
                  </span>
                  {(dur || sub) && (
                    <span className="flex flex-col items-center text-[10px] leading-tight tabular-nums text-muted">
                      {dur && <span>{dur}</span>}
                      {sub && <span className="text-brand-400/80">{sub}</span>}
                    </span>
                  )}
                </div>
                {!last && (
                  <div
                    className={cn(
                      'mx-1 mt-3.5 h-0.5 flex-1 rounded-full sm:mx-2',
                      complete ? 'bg-brand-600' : 'bg-border',
                    )}
                  />
                )}
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}
