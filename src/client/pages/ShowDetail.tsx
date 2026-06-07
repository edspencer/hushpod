import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Check, RefreshCw, Radio, Trash2 } from 'lucide-react'
import { Badge, Button, Card, CardContent, Dialog, Spinner } from '@client/components/ui'
import { useCheckShow, useDeleteShow, useShow, useShowAds } from '@client/lib/api'
import { AdTable } from '@client/components/AdTable'
import { CopyField } from '@client/components/CopyField'
import { EpisodeList } from '@client/components/EpisodeList'
import { ShowSettingsPanel } from '@client/components/ShowSettingsPanel'

function parseId(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

export default function ShowDetail() {
  const { id: rawId } = useParams<{ id: string }>()
  const id = parseId(rawId)
  const navigate = useNavigate()

  const showQuery = useShow(id)
  const adsQuery = useShowAds(id)
  const checkShow = useCheckShow()
  const deleteShow = useDeleteShow()

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleteFiles, setDeleteFiles] = useState(false)
  const [checkResult, setCheckResult] = useState<number | null>(null)

  if (id == null) {
    return (
      <ErrorState
        message="That show id is not valid."
        detail={`“${rawId ?? ''}” is not a recognized show.`}
      />
    )
  }

  if (showQuery.isPending) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted">
        <Spinner className="h-5 w-5" />
        <span className="text-sm">Loading show…</span>
      </div>
    )
  }

  if (showQuery.isError) {
    return (
      <ErrorState
        message="Couldn't load this show."
        detail={showQuery.error.message}
        onRetry={() => void showQuery.refetch()}
      />
    )
  }

  const show = showQuery.data
  const feedUrl = `${window.location.origin}/feed/${show.slug}`
  const ads = adsQuery.data ?? []

  const handleCheck = () => {
    setCheckResult(null)
    checkShow.mutate(id, {
      onSuccess: (res) => setCheckResult(res.discovered),
    })
  }

  const handleDelete = () => {
    deleteShow.mutate(
      { id, deleteFiles },
      {
        onSuccess: () => {
          setConfirmOpen(false)
          navigate('/')
        },
      },
    )
  }

  return (
    <div className="space-y-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to shows
      </Link>

      {/* Header */}
      <header className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="h-28 w-28 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-2">
          {show.imageUrl ? (
            <img src={show.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted">
              <Radio className="h-8 w-8" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{show.title}</h1>
            {show.isActive ? (
              <Badge variant="success">Active</Badge>
            ) : (
              <Badge variant="secondary">Paused</Badge>
            )}
          </div>
          {show.description && (
            <p className="line-clamp-3 max-w-2xl text-sm text-muted">{show.description}</p>
          )}
          <p className="text-xs text-muted">
            {show.episodeCount} {show.episodeCount === 1 ? 'episode' : 'episodes'}
          </p>
        </div>
      </header>

      {/* Feed URL */}
      <Card>
        <CardContent className="p-4 sm:p-5">
          <CopyField label="Clean feed URL" value={feedUrl} />
          <p className="mt-2 text-xs text-muted">
            Subscribe to this URL in your podcast app to get the ad-free feed.
          </p>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={handleCheck} disabled={checkShow.isPending}>
          {checkShow.isPending ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Check for new episodes
        </Button>

        {checkShow.isSuccess && checkResult != null && (
          <span className="inline-flex items-center gap-1.5 text-sm text-success">
            <Check className="h-4 w-4" />
            {checkResult === 0
              ? 'No new episodes'
              : `Found ${checkResult} new ${checkResult === 1 ? 'episode' : 'episodes'}`}
          </span>
        )}
        {checkShow.isError && (
          <span className="inline-flex items-center gap-1.5 text-sm text-danger">
            <AlertCircle className="h-4 w-4" />
            {checkShow.error.message}
          </span>
        )}

        <div className="ml-auto">
          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
            <Trash2 className="h-4 w-4" />
            Unsubscribe
          </Button>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-fg">Episodes</h2>
            <EpisodeList episodes={show.episodes} ads={ads} />
          </section>

          <AdTable ads={ads} />
        </div>

        <div className="space-y-6">
          <ShowSettingsPanel show={show} />
        </div>
      </div>

      {/* Delete confirm */}
      <Dialog
        open={confirmOpen}
        onClose={() => {
          if (!deleteShow.isPending) setConfirmOpen(false)
        }}
        title="Unsubscribe from show?"
        description={`This removes “${show.title}” and its episodes from HushPod.`}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={deleteShow.isPending}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteShow.isPending}>
              {deleteShow.isPending && <Spinner className="h-4 w-4" />}
              Unsubscribe
            </Button>
          </>
        }
      >
        <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface-2/40 p-3">
          <input
            type="checkbox"
            checked={deleteFiles}
            onChange={(e) => setDeleteFiles(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-brand-600"
          />
          <span className="text-sm">
            <span className="font-medium text-fg">Also delete downloaded files</span>
            <span className="mt-0.5 block text-xs text-muted">
              Permanently remove processed audio from disk. This cannot be undone.
            </span>
          </span>
        </label>
        {deleteShow.isError && (
          <p className="mt-3 text-xs text-danger">{deleteShow.error.message}</p>
        )}
      </Dialog>
    </div>
  )
}

function ErrorState({
  message,
  detail,
  onRetry,
}: {
  message: string
  detail?: string
  onRetry?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <AlertCircle className="h-8 w-8 text-danger" />
      <p className="text-base font-medium text-fg">{message}</p>
      {detail && <p className="max-w-md text-sm text-muted">{detail}</p>}
      <div className="mt-2 flex items-center gap-2">
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
        )}
        <Link to="/" className="text-sm font-medium text-brand-400 hover:underline">
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
