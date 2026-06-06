import { useState } from 'react';
import { Plus, Podcast, AlertCircle } from 'lucide-react';
import { Button, Spinner } from '@client/components/ui';
import { useShows, useStatus } from '@client/lib/api';
import { GlobalStats } from '@client/components/GlobalStats';
import { ShowCard } from '@client/components/ShowCard';
import { AddShowDialog } from '@client/components/AddShowDialog';

export default function Dashboard() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const shows = useShows();
  // Poll the system status so the per-show processing hint stays live.
  const status = useStatus(4000);

  // Are any episodes currently being processed system-wide? The status payload
  // exposes active episode ids (not show ids), so we cannot attribute work to a
  // specific show on the dashboard — we surface the hint on active shows while
  // the pipeline is busy. Precise per-episode status lives on the show page.
  const anyProcessing = (status.data?.queue.active.length ?? 0) > 0;

  const showList = shows.data ?? [];
  const isLoading = shows.isLoading;
  const error = shows.error;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            HushPod
          </h1>
          <p className="text-sm text-muted">
            Ad-free podcasts. Your shows and processing at a glance.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="sm:self-start">
          <Plus className="h-4 w-4" />
          Add Show
        </Button>
      </div>

      {/* Stats */}
      <GlobalStats />

      {/* Shows */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Shows
        </h2>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted">
            <Spinner className="h-5 w-5" />
            <span className="text-sm">Loading shows…</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-danger/30 bg-danger/5 py-16 text-center">
            <AlertCircle className="h-8 w-8 text-danger" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-fg">
                Couldn’t load your shows
              </p>
              <p className="text-sm text-muted">{error.message}</p>
            </div>
            <Button variant="outline" onClick={() => void shows.refetch()}>
              Try again
            </Button>
          </div>
        ) : showList.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border bg-surface/40 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-brand-400">
              <Podcast className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold text-fg">No shows yet</p>
              <p className="mx-auto max-w-sm text-sm text-muted">
                Add a podcast RSS feed and HushPod will start stripping the ads
                from new episodes automatically.
              </p>
            </div>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Add your first show
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {showList.map((show) => (
              <ShowCard
                key={show.id}
                show={show}
                processing={anyProcessing && show.isActive}
              />
            ))}
          </div>
        )}
      </section>

      <AddShowDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
