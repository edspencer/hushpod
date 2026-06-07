import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button, Input } from '@client/components/ui'
import { cn } from '@client/lib/cn'

export interface CopyFieldProps {
  value: string
  label?: string
  className?: string
}

export function CopyField({ value, label, className }: CopyFieldProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(t)
  }, [copied])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      /* clipboard unavailable; fall back to selection */
      const el = document.getElementById('copyfield-fallback') as HTMLInputElement | null
      el?.select()
    }
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && <span className="text-xs font-medium text-muted">{label}</span>}
      <div className="flex items-center gap-2">
        <Input
          id="copyfield-fallback"
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className="font-mono text-xs"
          aria-label={label ?? 'Copyable value'}
        />
        <Button
          type="button"
          variant={copied ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => void handleCopy()}
          aria-label={copied ? 'Copied' : 'Copy to clipboard'}
          className="shrink-0"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-success" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
