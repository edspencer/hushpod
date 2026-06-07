import { eq, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { settings } from '../db/schema.js'
import { SettingsSchema, type AppSettings, type SettingsUpdate } from '../../shared/schemas.js'

/**
 * Read all settings rows, merge over schema defaults, and return a fully typed,
 * validated AppSettings object. Missing keys fall back to their defaults, so a
 * fresh install works with an empty settings table.
 */
export function getSettings(): AppSettings {
  const rows = db.select().from(settings).all()
  const raw: Record<string, string> = {}
  for (const row of rows) raw[row.key] = row.value
  return SettingsSchema.parse(raw)
}

/** Read a single setting (still validated through the full schema). */
export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return getSettings()[key]
}

function serialize(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  return String(value)
}

/**
 * Validate and persist a partial settings update. Returns the full, updated
 * settings object. Unknown keys are rejected by the schema (strip mode).
 */
export function updateSettings(patch: SettingsUpdate): AppSettings {
  const now = new Date()
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined)

  if (entries.length > 0) {
    db.transaction((tx) => {
      for (const [key, value] of entries) {
        tx.insert(settings)
          .values({ key, value: serialize(value), updatedAt: now })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: serialize(value), updatedAt: now },
          })
          .run()
      }
    })
  }

  return getSettings()
}

/** Remove a setting, reverting it to its schema default. */
export function clearSetting(key: keyof AppSettings): void {
  db.delete(settings).where(eq(settings.key, key)).run()
}

/** True if the settings table has never been written (fresh install). */
export function settingsAreEmpty(): boolean {
  const rows = db
    .select({ count: sql<number>`count(*)` })
    .from(settings)
    .all()
  return (rows[0]?.count ?? 0) === 0
}
