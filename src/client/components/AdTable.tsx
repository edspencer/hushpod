import { useMemo } from 'react';
import { BarChart3, Megaphone } from 'lucide-react';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@client/components/ui';
import type { Ad, AdLabel } from '@client/lib/api';
import { cn } from '@client/lib/cn';

export interface AdTableProps {
  ads: Ad[];
  className?: string;
}

const LABELS: AdLabel[] = ['ad', 'promo', 'intro', 'outro'];

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function companyName(company: string | null): string {
  return company?.trim() ? company.trim() : 'Unknown';
}

export function AdTable({ ads, className }: AdTableProps) {
  const sorted = useMemo(() => {
    return [...ads].sort((a, b) => {
      const ca = companyName(a.company).toLowerCase();
      const cb = companyName(b.company).toLowerCase();
      if (ca !== cb) return ca.localeCompare(cb);
      if (a.episodeId !== b.episodeId) return a.episodeId - b.episodeId;
      return a.startTime - b.startTime;
    });
  }, [ads]);

  const topAdvertisers = useMemo(() => {
    const map = new Map<string, number>();
    for (const ad of ads) {
      const name = companyName(ad.company);
      map.set(name, (map.get(name) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5);
  }, [ads]);

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-muted" />
          Ads &amp; promos
        </CardTitle>
        <Badge variant="secondary" className="tabular-nums">
          {ads.length}
        </Badge>
      </CardHeader>

      {ads.length === 0 ? (
        <CardContent>
          <p className="text-sm text-muted">
            No ads have been detected for this show yet.
          </p>
        </CardContent>
      ) : (
        <>
          {topAdvertisers.length > 0 && (
            <div className="border-y border-border bg-surface-2/40 px-4 py-3 sm:px-5">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
                <BarChart3 className="h-3.5 w-3.5" />
                Top advertisers
              </div>
              <div className="flex flex-wrap gap-2">
                {topAdvertisers.map(([name, count]) => (
                  <Badge key={name} variant="outline">
                    {name}
                    <span className="ml-1 text-muted tabular-nums">
                      {count}
                    </span>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium sm:px-5">Company</th>
                  <th className="px-4 py-2.5 font-medium">Label</th>
                  <th className="px-4 py-2.5 font-medium">Episode</th>
                  <th className="px-4 py-2.5 font-medium sm:px-5">Length</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((ad) => (
                  <tr
                    key={ad.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2.5 sm:px-5">
                      <span className="font-medium text-fg">
                        {companyName(ad.company)}
                      </span>
                      {ad.adText && (
                        <span className="mt-0.5 block max-w-xs truncate text-xs text-muted">
                          {ad.adText}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge
                        variant={
                          LABELS.includes(ad.label) ? ad.label : 'secondary'
                        }
                      >
                        {ad.label}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted tabular-nums">
                      #{ad.episodeId}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted tabular-nums sm:px-5">
                      {formatDuration(ad.endTime - ad.startTime)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
