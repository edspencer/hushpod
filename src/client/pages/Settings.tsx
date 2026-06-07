import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AlertCircle, CheckCircle2, RotateCcw, Save } from 'lucide-react'
import { Button, Input, Label, Select, Spinner, Switch } from '@client/components/ui'
import { SettingsSection } from '@client/components/SettingsSection'
import { useSettings, useUpdateSettings } from '@client/lib/api'
import type { AppSettings } from '@client/lib/api'
import { cn } from '@client/lib/cn'

const REDACTED = '••••••'
const KEY_FIELDS: (keyof AppSettings)[] = ['whisperApiKey', 'llmApiKey']

/* ------------------------------------------------------------------ */
/* Field layout helper                                                */
/* ------------------------------------------------------------------ */

interface FieldProps {
  htmlFor: string
  label: string
  help?: ReactNode
  children: ReactNode
}

function Field({ htmlFor, label, help, children }: FieldProps) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {help ? <p className="text-xs text-muted">{help}</p> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Diff helper                                                        */
/* ------------------------------------------------------------------ */

function diffSettings(loaded: AppSettings, form: AppSettings): Partial<AppSettings> {
  const patch: Partial<AppSettings> = {}
  ;(Object.keys(form) as (keyof AppSettings)[]).forEach((key) => {
    const next = form[key]
    const prev = loaded[key]
    if (next === prev) return
    // Skip unchanged redacted key placeholders.
    if (KEY_FIELDS.includes(key) && next === REDACTED) return
    ;(patch as Record<keyof AppSettings, AppSettings[keyof AppSettings]>)[key] = next
  })
  return patch
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

export default function Settings() {
  const settingsQuery = useSettings()
  const updateSettings = useUpdateSettings()

  const loaded = settingsQuery.data
  const [form, setForm] = useState<AppSettings | null>(null)

  // Initialize / re-sync local form state when the loaded settings change.
  useEffect(() => {
    if (loaded) setForm(loaded)
  }, [loaded])

  const isDirty = useMemo(() => {
    if (!loaded || !form) return false
    return Object.keys(diffSettings(loaded, form)).length > 0
  }, [loaded, form])

  if (settingsQuery.isLoading || !form || !loaded) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  if (settingsQuery.isError) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>Failed to load settings: {settingsQuery.error.message}</span>
      </div>
    )
  }

  /* Typed setters -------------------------------------------------- */
  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  function setNumber<K extends keyof AppSettings>(key: K, raw: string) {
    const n = Number(raw)
    set(key, (Number.isFinite(n) ? n : 0) as AppSettings[K])
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!loaded || !form) return
    const patch = diffSettings(loaded, form)
    if (Object.keys(patch).length === 0) return
    updateSettings.mutate(patch)
  }

  function handleReset() {
    if (loaded) setForm(loaded)
    updateSettings.reset()
  }

  const showLlmBaseUrl = form.llmProvider === 'openai-compatible' || form.llmProvider === 'ollama'
  const isRemoteWhisper = form.whisperMode === 'remote'

  return (
    <form onSubmit={handleSubmit} className="space-y-6 pb-24">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-fg">Settings</h1>
        <p className="text-sm text-muted">
          Configure transcription, ad detection, and feed serving.
        </p>
      </header>

      {/* 1. LLM ------------------------------------------------------ */}
      <SettingsSection
        title="LLM (ad detection)"
        description="Model used to identify ad and promo segments in transcripts."
      >
        <Field htmlFor="llmProvider" label="Provider">
          <Select
            id="llmProvider"
            value={form.llmProvider}
            onChange={(e) => set('llmProvider', e.target.value as AppSettings['llmProvider'])}
          >
            <option value="openai-compatible">OpenAI-compatible</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="ollama">Ollama</option>
          </Select>
        </Field>

        {showLlmBaseUrl ? (
          <Field
            htmlFor="llmBaseUrl"
            label="Base URL"
            help={
              form.llmProvider === 'ollama'
                ? 'Ollama’s endpoint is typically http://localhost:11434/v1.'
                : 'Base URL of your OpenAI-compatible API.'
            }
          >
            <Input
              id="llmBaseUrl"
              value={form.llmBaseUrl}
              placeholder="http://localhost:11434/v1"
              onChange={(e) => set('llmBaseUrl', e.target.value)}
            />
          </Field>
        ) : null}

        <Field htmlFor="llmModel" label="Model">
          <Input
            id="llmModel"
            value={form.llmModel}
            onChange={(e) => set('llmModel', e.target.value)}
          />
        </Field>

        <Field
          htmlFor="llmApiKey"
          label="API key"
          help="Stored securely on the server; leave the dots in place to keep the current key."
        >
          <Input
            id="llmApiKey"
            type="password"
            autoComplete="off"
            value={form.llmApiKey}
            placeholder={loaded.llmApiKey === REDACTED ? REDACTED : 'sk-…'}
            onChange={(e) => set('llmApiKey', e.target.value)}
          />
        </Field>
      </SettingsSection>

      {/* 2. Transcription ------------------------------------------ */}
      <SettingsSection
        title="Transcription (Whisper)"
        description="Local mode uses whisper.cpp; remote mode uses an OpenAI-compatible /v1/audio/transcriptions endpoint."
      >
        <Field htmlFor="whisperMode" label="Mode">
          <Select
            id="whisperMode"
            value={form.whisperMode}
            onChange={(e) => set('whisperMode', e.target.value as AppSettings['whisperMode'])}
          >
            <option value="local">Local (whisper.cpp)</option>
            <option value="remote">Remote (OpenAI-compatible)</option>
          </Select>
        </Field>

        <Field
          htmlFor="whisperModel"
          label="Model"
          help={
            isRemoteWhisper
              ? 'Model name accepted by the remote endpoint, e.g. whisper-1.'
              : 'whisper.cpp model name, e.g. base.en or small.'
          }
        >
          <Input
            id="whisperModel"
            value={form.whisperModel}
            onChange={(e) => set('whisperModel', e.target.value)}
          />
        </Field>

        {isRemoteWhisper ? (
          <>
            <Field
              htmlFor="whisperEndpoint"
              label="Endpoint"
              help="Full URL to the /v1/audio/transcriptions endpoint."
            >
              <Input
                id="whisperEndpoint"
                value={form.whisperEndpoint}
                placeholder="https://api.openai.com/v1/audio/transcriptions"
                onChange={(e) => set('whisperEndpoint', e.target.value)}
              />
            </Field>

            <Field
              htmlFor="whisperApiKey"
              label="API key"
              help="Leave the dots in place to keep the current key."
            >
              <Input
                id="whisperApiKey"
                type="password"
                autoComplete="off"
                value={form.whisperApiKey}
                placeholder={loaded.whisperApiKey === REDACTED ? REDACTED : 'sk-…'}
                onChange={(e) => set('whisperApiKey', e.target.value)}
              />
            </Field>
          </>
        ) : null}
      </SettingsSection>

      {/* 3. Processing --------------------------------------------- */}
      <SettingsSection
        title="Processing"
        description="Scheduling and resource usage for the processing pipeline."
      >
        <div className="grid gap-5 sm:grid-cols-3">
          <Field htmlFor="checkIntervalMinutes" label="Check interval (minutes)">
            <Input
              id="checkIntervalMinutes"
              type="number"
              min={1}
              value={String(form.checkIntervalMinutes)}
              onChange={(e) => setNumber('checkIntervalMinutes', e.target.value)}
            />
          </Field>

          <Field htmlFor="crossfadeMs" label="Crossfade (ms)">
            <Input
              id="crossfadeMs"
              type="number"
              min={0}
              value={String(form.crossfadeMs)}
              onChange={(e) => setNumber('crossfadeMs', e.target.value)}
            />
          </Field>

          <Field htmlFor="downloadConcurrency" label="Download concurrency">
            <Input
              id="downloadConcurrency"
              type="number"
              min={1}
              value={String(form.downloadConcurrency)}
              onChange={(e) => setNumber('downloadConcurrency', e.target.value)}
            />
          </Field>

          <Field htmlFor="transcribeConcurrency" label="Transcribe concurrency">
            <Input
              id="transcribeConcurrency"
              type="number"
              min={1}
              value={String(form.transcribeConcurrency)}
              onChange={(e) => setNumber('transcribeConcurrency', e.target.value)}
            />
          </Field>

          <Field htmlFor="detectConcurrency" label="Detect concurrency">
            <Input
              id="detectConcurrency"
              type="number"
              min={1}
              value={String(form.detectConcurrency)}
              onChange={(e) => setNumber('detectConcurrency', e.target.value)}
            />
          </Field>
        </div>
      </SettingsSection>

      {/* 4. Serving ------------------------------------------------ */}
      <SettingsSection
        title="Serving"
        description="How HushPod exposes the cleaned feeds and audio."
      >
        <Field
          htmlFor="baseUrl"
          label="Base URL"
          help="Used to build absolute URLs in the clean RSS feeds (e.g. https://hushpod.example.com)."
        >
          <Input
            id="baseUrl"
            value={form.baseUrl}
            placeholder="https://hushpod.example.com"
            onChange={(e) => set('baseUrl', e.target.value)}
          />
        </Field>
      </SettingsSection>

      {/* 5. Transition sound detection ----------------------------- */}
      <SettingsSection
        title="Transition sound detection"
        description="Strips chimes and jingles near ad boundaries for cleaner cuts."
      >
        <div className="flex items-center justify-between gap-4">
          <div className="grid gap-1">
            <Label htmlFor="enableTransitionDetection">Enable transition detection</Label>
            <p className="text-xs text-muted">
              Detect and remove short transition sounds adjacent to ads.
            </p>
          </div>
          <Switch
            id="enableTransitionDetection"
            checked={form.enableTransitionDetection}
            onCheckedChange={(v) => set('enableTransitionDetection', v)}
            aria-label="Enable transition detection"
          />
        </div>

        {form.enableTransitionDetection ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              htmlFor="transitionWindowSeconds"
              label="Window (seconds)"
              help="How far around an ad boundary to search for transition sounds."
            >
              <Input
                id="transitionWindowSeconds"
                type="number"
                min={0}
                value={String(form.transitionWindowSeconds)}
                onChange={(e) => setNumber('transitionWindowSeconds', e.target.value)}
              />
            </Field>

            <Field
              htmlFor="transitionEnergyThreshold"
              label="Energy threshold"
              help="Lower values are more aggressive at flagging transitions."
            >
              <Input
                id="transitionEnergyThreshold"
                type="number"
                step={0.1}
                value={String(form.transitionEnergyThreshold)}
                onChange={(e) => setNumber('transitionEnergyThreshold', e.target.value)}
              />
            </Field>
          </div>
        ) : null}
      </SettingsSection>

      {/* Sticky action bar ----------------------------------------- */}
      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-3 border-t border-border bg-bg/80 px-1 py-3 backdrop-blur">
        <Button type="submit" disabled={!isDirty || updateSettings.isPending}>
          {updateSettings.isPending ? (
            <Spinner className="h-4 w-4 text-white" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save changes
        </Button>

        <Button
          type="button"
          variant="ghost"
          onClick={handleReset}
          disabled={!isDirty || updateSettings.isPending}
        >
          <RotateCcw className="h-4 w-4" />
          Reset
        </Button>

        {updateSettings.isSuccess && !isDirty ? (
          <span className={cn('inline-flex items-center gap-1.5 text-sm text-success')}>
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Saved
          </span>
        ) : null}

        {updateSettings.isError ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-danger">
            <AlertCircle className="h-4 w-4" aria-hidden />
            {updateSettings.error.message}
          </span>
        ) : null}
      </div>
    </form>
  )
}
