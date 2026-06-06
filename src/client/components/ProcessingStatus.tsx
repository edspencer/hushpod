import { AlertTriangle, Check, Loader2, Play, RotateCcw } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  StatusBadge,
} from '@client/components/ui';
import { useProcessEpisode, useReprocessEpisode } from '@client/lib/api';
import type { EpisodeStatus } from '@client/lib/api';
import { cn } from '@client/lib/cn';

const STEPS: { key: EpisodeStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'downloading', label: 'Download' },
  { key: 'transcribing', label: 'Transcribe' },
  { key: 'detecting', label: 'Detect' },
  { key: 'cutting', label: 'Cut' },
  { key: 'done', label: 'Done' },
];

function stepIndex(status: EpisodeStatus): number {
  const i = STEPS.findIndex((s) => s.key === status);
  return i === -1 ? 0 : i;
}

const IN_FLIGHT: ReadonlySet<EpisodeStatus> = new Set([
  'pending',
  'downloading',
  'transcribing',
  'detecting',
  'cutting',
]);

export interface ProcessingStatusProps {
  episodeId: number;
  status: EpisodeStatus;
  errorMessage: string | null;
  retryCount: number;
  className?: string;
}

export function ProcessingStatus({
  episodeId,
  status,
  errorMessage,
  retryCount,
  className,
}: ProcessingStatusProps) {
  const process = useProcessEpisode();
  const reprocess = useReprocessEpisode();

  const isError = status === 'error';
  const isDone = status === 'done';
  const inFlight = IN_FLIGHT.has(status);
  const current = stepIndex(status);
  const busy = process.isPending || reprocess.isPending;

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          Processing
          <StatusBadge status={status} />
        </CardTitle>
        <div className="flex items-center gap-2">
          {!isDone && !isError && (
            <Button
              size="sm"
              onClick={() => process.mutate(episodeId)}
              disabled={busy || inFlight}
            >
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
      <CardContent className="space-y-4">
        {isError ? (
          <div className="rounded-md border border-danger/40 bg-danger/10 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-danger">
              <AlertTriangle className="h-4 w-4" />
              Processing failed
            </div>
            {errorMessage && (
              <p className="mt-1 break-words text-sm text-fg/90">
                {errorMessage}
              </p>
            )}
            {retryCount > 0 && (
              <p className="mt-1 text-xs text-muted">
                {retryCount} {retryCount === 1 ? 'retry' : 'retries'} attempted
              </p>
            )}
          </div>
        ) : (
          <ol className="flex items-center">
            {STEPS.map((step, i) => {
              const complete = i < current || isDone;
              const active = i === current && inFlight;
              const last = i === STEPS.length - 1;
              return (
                <li
                  key={step.key}
                  className={cn('flex items-center', !last && 'flex-1')}
                >
                  <div className="flex flex-col items-center gap-1.5">
                    <div
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                        complete
                          ? 'border-brand-500 bg-brand-600 text-white'
                          : active
                            ? 'border-brand-500 bg-brand-500/15 text-brand-300'
                            : 'border-border bg-surface-2 text-muted',
                      )}
                    >
                      {complete ? (
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
                  </div>
                  {!last && (
                    <div
                      className={cn(
                        'mx-1 h-0.5 flex-1 rounded-full sm:mx-2',
                        i < current || isDone ? 'bg-brand-600' : 'bg-border',
                      )}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {(process.isError || reprocess.isError) && (
          <p className="text-xs text-danger">
            {process.error?.message ??
              reprocess.error?.message ??
              'Action failed.'}
          </p>
        )}
        {inFlight && (
          <p className="text-xs text-muted">
            This page updates automatically while processing runs.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
