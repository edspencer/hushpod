import { resolve } from 'node:path'

/**
 * Process-level configuration sourced from environment variables.
 *
 * These are the few settings that must be known *before* the database is open
 * (where it lives, what port to bind). Everything else — LLM provider, whisper
 * config, check interval — lives in the `settings` table and is editable at
 * runtime via the UI (see lib/settings.ts).
 */
function env(name: string, fallback: string): string {
  const v = process.env[name]
  return v && v.length > 0 ? v : fallback
}

export const DATA_DIR = resolve(env('HUSHPOD_DATA_DIR', './data'))
export const DB_PATH = resolve(env('HUSHPOD_DB_PATH', `${DATA_DIR}/hushpod.db`))
export const SHOWS_DIR = resolve(`${DATA_DIR}/shows`)
export const PORT = Number.parseInt(env('PORT', '3000'), 10)
export const HOST = env('HOST', '0.0.0.0')

// Built client assets. Resolved to an ABSOLUTE path at startup: nodejs-whisper
// chdir()s the process during transcription, so any cwd-relative static path
// would 404 while a transcription is running. This module loads before any
// processing begins, so process.cwd() here is still the real working dir.
export const CLIENT_DIR = resolve('dist/client')

/** Absolute path on disk for an episode's media directory. */
export function episodeDir(slug: string, guid: string): string {
  return resolve(SHOWS_DIR, slug, sanitizeGuid(guid))
}

/**
 * GUIDs can be arbitrary strings (often URLs). Make them filesystem-safe while
 * keeping them stable and collision-resistant for a single show.
 */
export function sanitizeGuid(guid: string): string {
  return guid.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200)
}
