import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Rss, AlertCircle } from 'lucide-react'
import { Dialog, Button, Input, Label, Spinner } from '@client/components/ui'
import { useAddShow, ApiError } from '@client/lib/api'

export interface AddShowDialogProps {
  open: boolean
  onClose: () => void
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

  const isValid = feedUrl.trim().length > 0
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
      description="Paste an RSS feed URL, an Apple Podcasts link, or a show's website — HushPod will find the feed."
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
          <Label htmlFor="feed-url">Feed URL or Apple Podcasts link</Label>
          <div className="relative">
            <Rss className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              id="feed-url"
              type="text"
              autoFocus
              placeholder="https://podcasts.apple.com/us/podcast/…  or  https://example.com/feed.xml"
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              disabled={isPending}
              className="pl-9"
            />
          </div>
          <p className="text-xs text-muted">
            Accepts an RSS feed, an Apple Podcasts URL or id, or a show&apos;s homepage.
          </p>
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
