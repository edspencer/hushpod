import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { SettingsUpdateSchema } from '../../shared/schemas.js'
import { getSettings, updateSettings } from '../lib/settings.js'

export const settingsRoute = new Hono()

/** GET /api/settings — full effective settings (defaults merged). API keys
 * are redacted so they aren't echoed back to the client. */
settingsRoute.get('/', (c) => {
  const s = getSettings()
  return c.json({
    ...s,
    llmApiKey: s.llmApiKey ? '••••••' : '',
    whisperApiKey: s.whisperApiKey ? '••••••' : '',
  })
})

/** PATCH /api/settings — partial update. Redaction placeholders are ignored. */
settingsRoute.patch('/', zValidator('json', SettingsUpdateSchema), (c) => {
  const patch = c.req.valid('json')
  if (patch.llmApiKey === '••••••') delete patch.llmApiKey
  if (patch.whisperApiKey === '••••••') delete patch.whisperApiKey
  const updated = updateSettings(patch)
  return c.json({ ...updated, llmApiKey: updated.llmApiKey ? '••••••' : '', whisperApiKey: updated.whisperApiKey ? '••••••' : '' })
})
