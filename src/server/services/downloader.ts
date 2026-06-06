import { createWriteStream } from 'node:fs'
import { mkdir, stat, unlink } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'
import { episodeDir } from '../lib/config.js'
import { logger } from '../lib/logger.js'

const log = logger('downloader')

const USER_AGENT = 'HushPod/0.1 (+https://github.com/hushpod)'
const MAX_BYTES = 800 * 1024 * 1024 // hard cap, independent of Content-Length
const TIMEOUT_MS = 30 * 60 * 1000

const CONTENT_TYPE_EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
}

function extFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname
    const m = path.match(/\.([a-z0-9]{2,4})$/i)
    return m ? m[1]!.toLowerCase() : null
  } catch {
    return null
  }
}

export interface DownloadResult {
  path: string
  size: number
  ext: string
}

/**
 * Download an episode's audio to data/shows/{slug}/{guid}/original.{ext}.
 * Follows CDN redirect chains, sends a browser-ish UA, enforces a hard byte
 * cap, and derives the extension from Content-Type (falling back to the URL).
 */
export async function downloadEpisode(sourceUrl: string, slug: string, guid: string): Promise<DownloadResult> {
  const dir = episodeDir(slug, guid)
  await mkdir(dir, { recursive: true })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(sourceUrl, {
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!res.ok || !res.body) throw new Error(`download failed (${res.status}) for ${sourceUrl}`)

    const ct = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    const ext = CONTENT_TYPE_EXT[ct] ?? extFromUrl(res.url) ?? extFromUrl(sourceUrl) ?? 'mp3'
    const path = join(dir, `original.${ext}`)

    // Stream to disk with a running byte cap.
    let written = 0
    const out = createWriteStream(path)
    const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
    source.on('data', (chunk: Buffer) => {
      written += chunk.length
      if (written > MAX_BYTES) {
        source.destroy(new Error(`download exceeded ${MAX_BYTES} byte cap`))
      }
    })
    await pipeline(source, out)

    const { size } = await stat(path)
    log.info(`downloaded ${(size / 1024 / 1024).toFixed(1)}MB -> ${path}`)
    return { path, size, ext }
  } catch (err) {
    // Clean up a partial file so a retry starts fresh.
    await unlink(join(dir, 'original.mp3')).catch(() => {})
    throw err
  } finally {
    clearTimeout(timeout)
  }
}
