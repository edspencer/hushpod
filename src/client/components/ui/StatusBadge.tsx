import { Badge } from './Badge';
import type { BadgeVariant } from './Badge';
import type { EpisodeStatus } from '@client/lib/api';

const statusMap: Record<
  EpisodeStatus,
  { label: string; variant: BadgeVariant }
> = {
  pending: { label: 'Pending', variant: 'secondary' },
  downloading: { label: 'Downloading', variant: 'info' },
  transcribing: { label: 'Transcribing', variant: 'info' },
  detecting: { label: 'Detecting', variant: 'info' },
  cutting: { label: 'Cutting', variant: 'info' },
  done: { label: 'Done', variant: 'success' },
  error: { label: 'Error', variant: 'danger' },
};

export interface StatusBadgeProps {
  status: EpisodeStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { label, variant } = statusMap[status] ?? {
    label: status,
    variant: 'secondary' as BadgeVariant,
  };
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}
