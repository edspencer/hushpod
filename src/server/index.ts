import { existsSync } from 'node:fs'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { runMigrations } from './db/migrate.js'
import { resumePending } from './services/processor.js'
import { checkAllShows } from './services/feed.js'
import { getSettings } from './lib/settings.js'
import { join } from 'node:path'
import { PORT, HOST, CLIENT_DIR } from './lib/config.js'
import { logger } from './lib/logger.js'
import { showsRoute } from './routes/shows.js'
import { episodesRoute } from './routes/episodes.js'
import { adsRoute } from './routes/ads.js'
import { settingsRoute } from './routes/settings.js'
import { statusRoute } from './routes/status.js'
import { eventsRoute } from './routes/events.js'
import { feedsRoute } from './routes/feeds.js'

const log = logger('server')

// Schema first, so a fresh container self-initializes.
runMigrations()

const app = new Hono()

app.get('/api/health', (c) => c.json({ ok: true, name: 'hushpod' }))

// API (order doesn't matter — paths are distinct across routers).
app.route('/api/shows', showsRoute)
app.route('/api/settings', settingsRoute)
app.route('/api/status', statusRoute)
app.route('/api', eventsRoute)
app.route('/api', episodesRoute)
app.route('/api', adsRoute)

// Public feeds + audio.
app.route('/', feedsRoute)

// Static client (built by Vite to dist/client). Present only in production.
// CLIENT_DIR is absolute so serving keeps working even while whisper has
// temporarily changed the process cwd during transcription.
if (existsSync(CLIENT_DIR)) {
  // Hashed assets are immutable — cache them aggressively.
  app.use('/assets/*', (c, next) => {
    c.header('Cache-Control', 'public, max-age=31536000, immutable')
    return serveStatic({ root: CLIENT_DIR })(c, next)
  })
  // The SPA shell must never be cached, or browsers keep loading a stale
  // index.html that points at an old (now-missing) bundle hash.
  app.get('*', (c, next) => {
    c.header('Cache-Control', 'no-cache')
    return serveStatic({ path: join(CLIENT_DIR, 'index.html') })(c, next)
  })
}

// Resume any work interrupted by a restart.
resumePending()

// Periodic feed checks.
const intervalMs = getSettings().checkIntervalMinutes * 60_000
setInterval(() => {
  checkAllShows().catch((e) => log.error(`scheduled feed check failed: ${(e as Error).message}`))
}, intervalMs)
log.info(`feed checks every ${getSettings().checkIntervalMinutes} min`)

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  log.info(`HushPod listening on http://${HOST}:${info.port}`)
})

export type AppType = typeof app
