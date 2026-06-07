import { forwardRef } from 'react'
import type { HTMLAttributes } from 'react'
import { cn } from '@client/lib/cn'

export type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'ad'
  | 'promo'
  | 'intro'
  | 'outro'

const variantClasses: Record<BadgeVariant, string> = {
  default: 'border-transparent bg-brand-600 text-white',
  secondary: 'border-transparent bg-surface-2 text-fg',
  outline: 'border-border bg-transparent text-fg',
  success: 'border-transparent bg-success/15 text-success',
  warning: 'border-transparent bg-warning/15 text-warning',
  danger: 'border-transparent bg-danger/15 text-danger',
  info: 'border-transparent bg-info/15 text-info',
  ad: 'border-transparent bg-danger/15 text-danger',
  promo: 'border-transparent bg-warning/15 text-warning',
  intro: 'border-transparent bg-info/15 text-info',
  outro: 'border-transparent bg-brand-500/15 text-brand-300',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-none whitespace-nowrap',
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  ),
)
Badge.displayName = 'Badge'
