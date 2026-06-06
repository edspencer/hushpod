import { Loader2 } from 'lucide-react';
import { cn } from '@client/lib/cn';

export interface SpinnerProps {
  className?: string;
  label?: string;
}

export function Spinner({ className, label = 'Loading' }: SpinnerProps) {
  return (
    <Loader2
      role="status"
      aria-label={label}
      className={cn('h-4 w-4 animate-spin text-muted', className)}
    />
  );
}
