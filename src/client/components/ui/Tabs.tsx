import { cn } from '@client/lib/cn'

export interface TabItem {
  value: string
  label: string
}

export interface TabsProps {
  items: TabItem[]
  value: string
  onValueChange: (value: string) => void
  className?: string
}

/** Underline-style tab strip (controlled). The caller renders the active panel. */
export function Tabs({ items, value, onValueChange, className }: TabsProps) {
  return (
    <div className={cn('flex items-center gap-1 border-b border-border', className)} role="tablist">
      {items.map((t) => {
        const active = t.value === value
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onValueChange(t.value)}
            className={cn(
              '-mb-px border-b-2 px-3.5 py-2 text-sm font-medium transition-colors',
              active ? 'border-brand-500 text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
