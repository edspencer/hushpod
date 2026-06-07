import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import {
  Button,
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
import type { Show, ShowSettingsPatch } from '@client/lib/api'

export interface ShowSettingsPanelProps {
  show: Show
}

interface FormState {
  isActive: boolean
  removeAds: boolean
  removePromos: boolean
  episodeLimit: string
  detectionGuidance: string
}

function fromShow(show: Show): FormState {
  return {
    isActive: show.isActive,
    removeAds: show.removeAds,
    removePromos: show.removePromos,
    episodeLimit: String(show.episodeLimit),
    detectionGuidance: show.detectionGuidance ?? '',
  }
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
  const [form, setForm] = useState<FormState>(() => fromShow(show))

  // Re-initialize only when switching to a different show.
  useEffect(() => {
    setForm(fromShow(show))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show.id])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const limitNum = Math.trunc(Number(form.episodeLimit))
  const limitValid = Number.isFinite(limitNum) && limitNum >= 0

  const baseline = fromShow(show)
  const dirty =
    form.isActive !== baseline.isActive ||
    form.removeAds !== baseline.removeAds ||
    form.removePromos !== baseline.removePromos ||
    form.episodeLimit !== baseline.episodeLimit ||
    form.detectionGuidance !== baseline.detectionGuidance

  const save = () => {
    if (!dirty || !limitValid) return
    const patch: ShowSettingsPatch = {}
    if (form.isActive !== show.isActive) patch.isActive = form.isActive
    if (form.removeAds !== show.removeAds) patch.removeAds = form.removeAds
    if (form.removePromos !== show.removePromos) patch.removePromos = form.removePromos
    if (limitNum !== show.episodeLimit) patch.episodeLimit = limitNum
    const g = form.detectionGuidance.trim()
    if (g !== (show.detectionGuidance ?? '')) patch.detectionGuidance = g || null
    update.mutate({ id: show.id, patch })
  }

  const justSaved = update.isSuccess && !dirty

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border">
          <Row
            title="Active"
            description="Automatically check and process new episodes."
            control={
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => set('isActive', v)}
                aria-label="Active"
              />
            }
          />
          <Row
            title="Remove ads"
            description="Strip detected advertisements from the clean feed."
            control={
              <Switch
                checked={form.removeAds}
                onCheckedChange={(v) => set('removeAds', v)}
                aria-label="Remove ads"
              />
            }
          />
          <Row
            title="Remove promos"
            description="Strip cross-promotions and host reads."
            control={
              <Switch
                checked={form.removePromos}
                onCheckedChange={(v) => set('removePromos', v)}
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
                value={form.episodeLimit}
                onChange={(e) => set('episodeLimit', e.target.value)}
                className="w-24 text-right"
                aria-invalid={!limitValid}
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
            value={form.detectionGuidance}
            onChange={(e) => set('detectionGuidance', e.target.value)}
            placeholder="Optional — describe how this show's ads/promos behave…"
            className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* Save bar */}
        <div className="mt-4 flex items-center justify-end gap-3 border-t border-border pt-4">
          {update.isError && (
            <span className="mr-auto text-xs text-danger">
              Failed to save: {update.error.message}
            </span>
          )}
          {justSaved && (
            <span className="mr-auto inline-flex items-center gap-1 text-xs text-success">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          <Button
            variant="outline"
            onClick={() => setForm(fromShow(show))}
            disabled={!dirty || update.isPending}
          >
            Reset
          </Button>
          <Button onClick={save} disabled={!dirty || !limitValid || update.isPending}>
            {update.isPending && <Spinner className="h-4 w-4" />}
            Save changes
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
