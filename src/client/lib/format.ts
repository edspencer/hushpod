/** Compact duration from milliseconds, e.g. "920ms", "8.4s", "3m 12s". */
export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`
  const m = Math.floor(s / 60)
  const r = Math.round(s % 60)
  if (m < 60) return r ? `${m}m ${r}s` : `${m}m`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return mm ? `${h}h ${mm}m` : `${h}h`
}

/** Coarse "x ago" relative time from an ISO timestamp. */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.round(diff / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

/** Bytes as MB/GB. */
export function formatBytes(n: number | null | undefined): string {
  if (!n) return '—'
  const mb = n / (1024 * 1024)
  return mb < 1024 ? `${mb.toFixed(1)} MB` : `${(mb / 1024).toFixed(2)} GB`
}

/** Estimated USD cost. 0 (local model) renders as "free". */
export function formatUsd(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n === 0) return 'free'
  if (n < 0.01) return `<$0.01`
  return `$${n.toFixed(n < 1 ? 3 : 2)}`
}

/** Token counts, e.g. 12.3k. */
export function formatTokens(n: number | null | undefined): string {
  if (!n) return '—'
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`
}
