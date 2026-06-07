import { useEffect, useState } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Spinner,
  Switch,
} from '@client/components/ui'
import { useUpdateShow } from '@client/lib/api'
import type { Show } from '@client/lib/api'

export interface ShowSettingsPanelProps {
  show: Show
}

function Row({
  title,
  description,
  control,
  htmlFor,
}: {
  title: string
  description: string
  control: React.ReactNode
  htmlFor?: string
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <Label htmlFor={htmlFor} className="cursor-default">
          {title}
        </Label>
        <p className="mt-0.5 text-xs text-muted">{description}</p>
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  )
}

export function ShowSettingsPanel({ show }: ShowSettingsPanelProps) {
  const update = useUpdateShow()
  const [limit, setLimit] = useState(String(show.episodeLimit))
  const [guidance, setGuidance] = useState(show.detectionGuidance ?? '')

  // Keep local input in sync if the show changes from elsewhere.
  useEffect(() => {
    setLimit(String(show.episodeLimit))
  }, [show.episodeLimit])
  useEffect(() => {
    setGuidance(show.detectionGuidance ?? '')
  }, [show.detectionGuidance])

  const patch = (p: Parameters<typeof update.mutate>[0]['patch']) =>
    update.mutate({ id: show.id, patch: p })

  const commitLimit = () => {
    const parsed = Math.trunc(Number(limit))
    if (!Number.isFinite(parsed) || parsed < 0) {
      setLimit(String(show.episodeLimit))
      return
    }
    if (parsed !== show.episodeLimit) {
      patch({ episodeLimit: parsed })
    } else {
      setLimit(String(parsed))
    }
  }

  const commitGuidance = () => {
    const trimmed = guidance.trim()
    const current = show.detectionGuidance ?? ''
    if (trimmed !== current) patch({ detectionGuidance: trimmed || null })
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>Settings</CardTitle>
        {update.isPending && <Spinner label="Saving" />}
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border">
          <Row
            title="Active"
            description="Automatically check and process new episodes."
            control={
              <Switch
                checked={show.isActive}
                onCheckedChange={(v) => patch({ isActive: v })}
                aria-label="Active"
              />
            }
          />
          <Row
            title="Remove ads"
            description="Strip detected advertisements from the clean feed."
            control={
              <Switch
                checked={show.removeAds}
                onCheckedChange={(v) => patch({ removeAds: v })}
                aria-label="Remove ads"
              />
            }
          />
          <Row
            title="Remove promos"
            description="Strip cross-promotions and host reads."
            control={
              <Switch
                checked={show.removePromos}
                onCheckedChange={(v) => patch({ removePromos: v })}
                aria-label="Remove promos"
              />
            }
          />
          <Row
            htmlFor="episode-limit"
            title="Episode limit"
            description="Most recent episodes to keep. Use 0 for unlimited."
            control={
              <Input
                id="episode-limit"
                type="number"
                min={0}
                inputMode="numeric"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                onBlur={commitLimit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
                className="w-24 text-right"
                aria-label="Episode limit"
              />
            }
          />
        </div>

        <div className="mt-4 space-y-1.5 border-t border-border pt-4">
          <Label htmlFor="detection-guidance" className="cursor-default">
            Detection guidance
          </Label>
          <p className="text-xs text-muted">
            Free-form hints for the ad detector on this show. e.g. &ldquo;Sponsor reads are
            60&ndash;90s near the start and a promo at the very end; the long interview is editorial
            and must never be cut.&rdquo; Applies on the next (re)process.
          </p>
          <textarea
            id="detection-guidance"
            rows={4}
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            onBlur={commitGuidance}
            placeholder="Optional — describe how this show's ads/promos behave…"
            className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {update.isError && (
          <p className="mt-3 text-xs text-danger">Failed to save: {update.error.message}</p>
        )}
      </CardContent>
    </Card>
  )
}
