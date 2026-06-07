import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Rss, AlertCircle } from 'lucide-react'
import { Dialog, Button, Input, Label, Spinner } from '@client/components/ui'
import { useAddShow, ApiError } from '@client/lib/api'

export interface AddShowDialogProps {
  open: boolean
  onClose: () => void
}

function looksLikeUrl(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function AddShowDialog({ open, onClose }: AddShowDialogProps) {
  const [feedUrl, setFeedUrl] = useState('')
  const addShow = useAddShow()

  // Reset local state whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) {
      setFeedUrl('')
      addShow.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const isValid = looksLikeUrl(feedUrl)
  const isPending = addShow.isPending

  const errorMessage =
    addShow.error instanceof ApiError
      ? addShow.error.message
      : addShow.error
        ? addShow.error.message
        : null

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!isValid || isPending) return
    addShow.mutate(feedUrl.trim(), {
      onSuccess: () => {
        onClose()
      },
    })
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a show"
      description="Paste an RSS feed URL and HushPod will start tracking new episodes."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" form="add-show-form" disabled={!isValid || isPending}>
            {isPending ? (
              <>
                <Spinner className="text-white" label="Adding" />
                Adding…
              </>
            ) : (
              'Add show'
            )}
          </Button>
        </>
      }
    >
      <form id="add-show-form" onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="feed-url">RSS feed URL</Label>
          <div className="relative">
            <Rss className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              id="feed-url"
              type="url"
              inputMode="url"
              autoFocus
              placeholder="https://example.com/feed.xml"
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              disabled={isPending}
              className="pl-9"
              aria-invalid={feedUrl.length > 0 && !isValid}
            />
          </div>
          {feedUrl.length > 0 && !isValid && (
            <p className="text-xs text-muted">Enter a valid http(s) URL.</p>
          )}
        </div>

        {errorMessage && (
          <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </form>
    </Dialog>
  )
}
