import type { ReactNode } from 'react';
import {
  Podcast,
  ListMusic,
  Scissors,
  Clock,
  Radio,
} from 'lucide-react';
import { Card } from '@client/components/ui';
import { useShows, useAdsStats, useStatus } from '@client/lib/api';

/** Format a duration in seconds as a compact human string, e.g. "2h 14m". */
function formatDuration(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds < 0) return '0m';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    const seconds = Math.floor(totalSeconds % 60);
    return seconds > 0 && minutes < 5 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${Math.floor(totalSeconds)}s`;
}

function StatCard({
  icon,
  label,
  value,
  loading,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  loading: boolean;
}) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-brand-400">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted">{label}</p>
          {loading ? (
            <div className="mt-1 h-6 w-16 animate-pulse rounded bg-surface-2" />
          ) : (
            <p className="text-xl font-semibold leading-tight text-fg">
              {value}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

export function GlobalStats() {
  const shows = useShows();
  const adsStats = useAdsStats();
  const status = useStatus(4000);

  const totalShows = shows.data?.length ?? 0;
  const episodesDone = status.data?.episodes?.done ?? 0;
  const totalAds = adsStats.data?.totalAds ?? 0;
  const totalSeconds = adsStats.data?.totalSeconds ?? 0;
  const activeCount = status.data?.queue.active.length ?? 0;

  return (
    <div className="space-y-3">
      {activeCount > 0 && (
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-success">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          <Radio className="h-3.5 w-3.5" />
          Processing {activeCount} {activeCount === 1 ? 'episode' : 'episodes'}…
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={<Podcast className="h-5 w-5" />}
          label="Shows"
          value={String(totalShows)}
          loading={shows.isLoading}
        />
        <StatCard
          icon={<ListMusic className="h-5 w-5" />}
          label="Episodes processed"
          value={String(episodesDone)}
          loading={status.isLoading}
        />
        <StatCard
          icon={<Scissors className="h-5 w-5" />}
          label="Ads removed"
          value={totalAds.toLocaleString()}
          loading={adsStats.isLoading}
        />
        <StatCard
          icon={<Clock className="h-5 w-5" />}
          label="Ad time removed"
          value={formatDuration(totalSeconds)}
          loading={adsStats.isLoading}
        />
      </div>
    </div>
  );
}
