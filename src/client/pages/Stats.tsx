import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useStatus } from '@client/lib/api'
import { StatCards } from '@client/components/GlobalStats'
import { QueueTable } from '@client/components/QueueTable'
import { ActivityFeed } from '@client/components/ActivityFeed'

/** Top-level stats: headline metrics, the processing queue, and the full
 * activity feed — the dashboard's deeper companion. */
export default function Stats() {
  const status = useStatus(4000)
  const items = status.data?.queue.items ?? []

  // Scroll to the activity section when arrived at via /stats#activity.
  const { hash } = useLocation()
  const activityRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (hash === '#activity') {
      activityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [hash])

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Stats</h1>
        <p className="text-sm text-muted">
          Pipeline metrics, the processing queue, and recent activity.
        </p>
      </div>

      <StatCards />

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Processing queue
        </h2>
        <QueueTable items={items} />
      </section>

      <section ref={activityRef} id="activity" className="scroll-mt-20 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Activity</h2>
        <ActivityFeed limit={150} maxHeightClass="max-h-[42rem]" />
      </section>
    </div>
  )
}
