import { AlertTriangle, Loader2, Play, RotateCcw } from 'lucide-react'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  StatusBadge,
} from '@client/components/ui'
import { useProcessEpisode, useReprocessEpisode } from '@client/lib/api'
import type { EpisodeStatus } from '@client/lib/api'

const IN_FLIGHT: ReadonlySet<EpisodeStatus> = new Set([
  'pending',
  'downloading',
  'transcribing',
  'detecting',
  'cutting',
])

export interface ProcessingStatusProps {
  episodeId: number
  status: EpisodeStatus
  errorMessage: string | null
  retryCount: number
  className?: string
}

/** Compact, always-visible episode status + Process/Reprocess action. The full
 * per-stage pipeline visual lives on the episode's Stats tab (PipelineStepper). */
export function ProcessingStatus({
  episodeId,
  status,
  errorMessage,
  retryCount,
  className,
}: ProcessingStatusProps) {
  const process = useProcessEpisode()
  const reprocess = useReprocessEpisode()

  const isError = status === 'error'
  const isDone = status === 'done'
  const inFlight = IN_FLIGHT.has(status)
  const busy = process.isPending || reprocess.isPending

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          Status
          <StatusBadge status={status} />
        </CardTitle>
        <div className="flex items-center gap-2">
          {!isDone && !isError && (
            <Button size="sm" onClick={() => process.mutate(episodeId)} disabled={busy || inFlight}>
              {busy && process.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Process
            </Button>
          )}
          {(isDone || isError) && (
            <Button
              size="sm"
              variant={isError ? 'default' : 'outline'}
              onClick={() => reprocess.mutate(episodeId)}
              disabled={busy}
            >
              {busy && reprocess.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              Reprocess
            </Button>
          )}
        </div>
      </CardHeader>

      {(isError || inFlight || process.isError || reprocess.isError) && (
        <CardContent className="space-y-2">
          {isError && (
            <div className="rounded-md border border-danger/40 bg-danger/10 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-danger">
                <AlertTriangle className="h-4 w-4" />
                Processing failed
              </div>
              {errorMessage && (
                <p className="mt-1 break-words text-sm text-fg/90">{errorMessage}</p>
              )}
              {retryCount > 0 && (
                <p className="mt-1 text-xs text-muted">
                  {retryCount} {retryCount === 1 ? 'retry' : 'retries'} attempted
                </p>
              )}
            </div>
          )}
          {(process.isError || reprocess.isError) && (
            <p className="text-xs text-danger">
              {process.error?.message ?? reprocess.error?.message ?? 'Action failed.'}
            </p>
          )}
          {inFlight && (
            <p className="text-xs text-muted">
              This page updates automatically while processing runs.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  )
}
