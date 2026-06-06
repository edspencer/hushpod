import { useState } from 'react';
import { ChevronDown, Scissors } from 'lucide-react';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@client/components/ui';
import type { Ad, AdLabel } from '@client/lib/api';
import { cn } from '@client/lib/cn';

function fmtTime(total: number): string {
  if (!Number.isFinite(total) || total < 0) total = 0;
  const t = Math.floor(total);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${pad(s)}` : `${mm}:${pad(s)}`;
}

function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

const LABEL_TEXT: Record<AdLabel, string> = {
  ad: 'Ad',
  promo: 'Promo',
  intro: 'Intro',
  outro: 'Outro',
};

function AdCard({ ad }: { ad: Ad }) {
  const [expanded, setExpanded] = useState(false);
  const duration = Math.max(0, ad.endTime - ad.startTime);
  const text = ad.adText ?? '';
  const isLong = text.length > 180;

  return (
    <div className="rounded-md border border-border bg-surface-2/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={ad.label}>{LABEL_TEXT[ad.label]}</Badge>
          <span className="text-sm font-medium text-fg">
            {ad.company ?? 'Unknown advertiser'}
          </span>
        </div>
        <span className="font-mono text-xs text-muted">
          {fmtTime(ad.startTime)}&ndash;{fmtTime(ad.endTime)} ·{' '}
          {fmtDuration(duration)}
        </span>
      </div>

      {ad.reason && (
        <p className="mt-2 text-xs text-muted">{ad.reason}</p>
      )}

      {text && (
        <div className="mt-2">
          <p
            className={cn(
              'text-sm text-fg/80',
              isLong && !expanded && 'line-clamp-2',
            )}
          >
            {text}
          </p>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-400 hover:underline"
            >
              {expanded ? 'Show less' : 'Show more'}
              <ChevronDown
                className={cn(
                  'h-3 w-3 transition-transform',
                  expanded && 'rotate-180',
                )}
              />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export interface AdListProps {
  ads: Ad[];
  originalDuration: number | null;
  className?: string;
}

export function AdList({ ads, originalDuration, className }: AdListProps) {
  const removedSeconds = ads.reduce(
    (sum, ad) => sum + Math.max(0, ad.endTime - ad.startTime),
    0,
  );
  const cleanDuration =
    originalDuration != null
      ? Math.max(0, originalDuration - removedSeconds)
      : null;

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <Scissors className="h-4 w-4 text-brand-400" />
          Detected segments
        </CardTitle>
        <span className="text-xs text-muted">
          {ads.length} {ads.length === 1 ? 'segment' : 'segments'},{' '}
          {fmtDuration(removedSeconds)} removed
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {originalDuration != null && (
          <div className="grid grid-cols-3 gap-2 rounded-md border border-border bg-surface-2/40 p-3 text-center">
            <div>
              <div className="text-xs text-muted">Original</div>
              <div className="font-mono text-sm font-semibold text-fg">
                {fmtTime(originalDuration)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">Removed</div>
              <div className="font-mono text-sm font-semibold text-danger">
                &minus;{fmtTime(removedSeconds)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">Clean</div>
              <div className="font-mono text-sm font-semibold text-success">
                {cleanDuration != null ? fmtTime(cleanDuration) : '—'}
              </div>
            </div>
          </div>
        )}

        {ads.length === 0 ? (
          <p className="py-2 text-sm text-muted">
            No ads or promos detected yet.
          </p>
        ) : (
          <div className="space-y-2">
            {ads.map((ad) => (
              <AdCard key={ad.id} ad={ad} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
