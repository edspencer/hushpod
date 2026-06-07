import { useMemo } from 'react'
import { PieChart } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@client/components/ui'
import type { Ad, AdLabel, Episode } from '@client/lib/api'
import { cn } from '@client/lib/cn'

// Category order is also the stacking order (bottom → top in the area chart).
const CATS = [
  {
    key: 'content',
    label: 'Content',
    fill: 'fill-stone-500',
    stroke: 'stroke-stone-500',
    bg: 'bg-stone-500',
  },
  { key: 'ad', label: 'Ads', fill: 'fill-danger', stroke: 'stroke-danger', bg: 'bg-danger' },
  {
    key: 'promo',
    label: 'Promos',
    fill: 'fill-warning',
    stroke: 'stroke-warning',
    bg: 'bg-warning',
  },
  { key: 'fluff', label: 'Fluff', fill: 'fill-info', stroke: 'stroke-info', bg: 'bg-info' },
] as const

type CatKey = (typeof CATS)[number]['key']
type Breakdown = Record<CatKey, number>

interface EpisodePoint extends Breakdown {
  id: number
  date: number
  total: number
}

function fmtMin(seconds: number): string {
  const m = seconds / 60
  if (m >= 60) return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`
  return `${m < 10 ? m.toFixed(1) : Math.round(m)}m`
}

export interface ShowStatsProps {
  episodes: Episode[]
  ads: Ad[]
  className?: string
}

export function ShowStats({ episodes, ads, className }: ShowStatsProps) {
  const points = useMemo<EpisodePoint[]>(() => {
    const adsByEp = new Map<number, Ad[]>()
    for (const a of ads) {
      const l = adsByEp.get(a.episodeId)
      if (l) l.push(a)
      else adsByEp.set(a.episodeId, [a])
    }
    return episodes
      .filter((e) => e.status === 'done' && e.duration && e.duration > 0)
      .map((e) => {
        const removed: Breakdown = { content: 0, ad: 0, promo: 0, fluff: 0 }
        for (const a of adsByEp.get(e.id) ?? []) {
          removed[a.label as AdLabel] += Math.max(0, a.endTime - a.startTime)
        }
        const total = e.duration as number
        const cut = removed.ad + removed.promo + removed.fluff
        removed.content = Math.max(0, total - cut)
        return {
          id: e.id,
          date: e.publishedAt ? new Date(e.publishedAt).getTime() : 0,
          total,
          ...removed,
        }
      })
      .sort((a, b) => a.date - b.date)
  }, [episodes, ads])

  const totals = useMemo<Breakdown>(() => {
    const t: Breakdown = { content: 0, ad: 0, promo: 0, fluff: 0 }
    for (const p of points) for (const c of CATS) t[c.key] += p[c.key]
    return t
  }, [points])

  const grand = CATS.reduce((s, c) => s + totals[c.key], 0)

  if (points.length === 0 || grand === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PieChart className="h-4 w-4 text-brand-400" />
            Content vs. ads
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-4 text-sm text-muted">
            No processed episodes yet — stats appear once episodes finish.
          </p>
        </CardContent>
      </Card>
    )
  }

  const contentPct = Math.round((totals.content / grand) * 100)
  const removedSecs = grand - totals.content

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PieChart className="h-4 w-4 text-brand-400" />
          Content vs. ads
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
          <Donut totals={totals} grand={grand} contentPct={contentPct} />
          <div className="flex-1 space-y-2">
            <Legend totals={totals} grand={grand} />
            <p className="pt-1 text-xs text-muted">
              {fmtMin(removedSecs)} removed of {fmtMin(grand)} across {points.length}{' '}
              {points.length === 1 ? 'episode' : 'episodes'}.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted">
            Composition over time (% of each episode)
          </div>
          <StackedArea points={points} />
        </div>
      </CardContent>
    </Card>
  )
}

function Donut({
  totals,
  grand,
  contentPct,
}: {
  totals: Breakdown
  grand: number
  contentPct: number
}) {
  // stroke-dasharray on a circle whose circumference == 100 → values are %.
  const R = 15.915
  const slices = CATS.map((c, i) => ({
    c,
    pct: (totals[c.key] / grand) * 100,
    offset: CATS.slice(0, i).reduce((s, p) => s + (totals[p.key] / grand) * 100, 0),
  }))
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
        {slices.map(({ c, pct, offset }) => (
          <circle
            key={c.key}
            cx="18"
            cy="18"
            r={R}
            fill="none"
            strokeWidth="4"
            className={c.stroke}
            strokeDasharray={`${pct} ${100 - pct}`}
            strokeDashoffset={-offset}
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold text-fg">{contentPct}%</span>
        <span className="text-[11px] text-muted">content</span>
      </div>
    </div>
  )
}

function Legend({ totals, grand }: { totals: Breakdown; grand: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
      {CATS.map((c) => {
        const pct = Math.round((totals[c.key] / grand) * 100)
        if (totals[c.key] <= 0) return null
        return (
          <div key={c.key} className="flex items-center gap-2 text-xs">
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', c.bg)} />
            <span className="text-fg">{c.label}</span>
            <span className="ml-auto tabular-nums text-muted">
              {pct}% · {fmtMin(totals[c.key])}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function StackedArea({ points }: { points: EpisodePoint[] }) {
  const W = 640
  const H = 180
  const padL = 4
  const padR = 4
  const padT = 8
  const padB = 18
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  // A single episode can't form an area; duplicate it into a flat full-width band.
  const series = points.length === 1 ? [points[0]!, points[0]!] : points
  const n = series.length

  // Normalize each episode to 100% so the chart shows composition, not length.
  const frac = (s: EpisodePoint, key: CatKey) => (s.total > 0 ? s[key] / s.total : 0)

  const x = (i: number) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v: number) => padT + innerH - v * innerH // v is a fraction 0..1

  const areas = CATS.map((c, k) => {
    const pts = series.map((s, i) => {
      // base = stacked fraction of all categories below this one for this episode
      const b = CATS.slice(0, k).reduce((sum, pc) => sum + frac(s, pc.key), 0)
      const top = b + frac(s, c.key)
      return { x: x(i), yTop: y(top), yBase: y(b) }
    })
    const top = pts.map((p) => `${p.x.toFixed(1)},${p.yTop.toFixed(1)}`).join(' ')
    const bottom = [...pts]
      .reverse()
      .map((p) => `${p.x.toFixed(1)},${p.yBase.toFixed(1)}`)
      .join(' ')
    return { c, points: `${top} ${bottom}` }
  })

  const gridYs = [0, 0.5, 1]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" preserveAspectRatio="none">
      {gridYs.map((g, i) => (
        <g key={i}>
          <line
            x1={padL}
            x2={W - padR}
            y1={y(g)}
            y2={y(g)}
            className="stroke-border"
            strokeWidth="0.5"
          />
          <text x={padL} y={y(g) - 2} className="fill-muted" fontSize="8">
            {Math.round(g * 100)}%
          </text>
        </g>
      ))}
      {areas.map((a) => (
        <polygon key={a.c.key} points={a.points} className={a.c.fill} fillOpacity="0.85" />
      ))}
      {/* x-axis: oldest → newest */}
      <text x={padL} y={H - 4} className="fill-muted" fontSize="8">
        oldest
      </text>
      <text x={W - padR} y={H - 4} textAnchor="end" className="fill-muted" fontSize="8">
        newest
      </text>
    </svg>
  )
}
