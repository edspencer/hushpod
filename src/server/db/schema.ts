import { sqliteTable, integer, text, real, unique } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'

/**
 * Shows — a podcast feed HushPod subscribes to.
 */
export const shows = sqliteTable('shows', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  feedUrl: text('feed_url').notNull().unique(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  imageUrl: text('image_url'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  episodeLimit: integer('episode_limit').notNull().default(10),
  removeAds: integer('remove_ads', { mode: 'boolean' }).notNull().default(true),
  removePromos: integer('remove_promos', { mode: 'boolean' }).notNull().default(true),
  // Recurring show scaffolding (intro spiel, sign-off, credits, etc.). Detected
  // by default but KEPT unless the user opts in per show.
  removeFluff: integer('remove_fluff', { mode: 'boolean' }).notNull().default(false),
  // Free-form, per-show guidance injected into the ad-detection prompt.
  detectionGuidance: text('detection_guidance'),
  lastCheckedAt: integer('last_checked_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
})

/**
 * Episodes — an individual episode from a show's RSS feed.
 */
export const episodes = sqliteTable(
  'episodes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    showId: integer('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    guid: text('guid').notNull(), // RSS <guid>, unique per show
    title: text('title').notNull(),
    description: text('description'),
    publishedAt: integer('published_at', { mode: 'timestamp' }),
    sourceUrl: text('source_url').notNull(), // Original audio URL from RSS
    duration: real('duration'), // Seconds (from RSS or detected)
    originalPath: text('original_path'), // Local path to downloaded original
    cleanPath: text('clean_path'), // Local path to ad-free version
    originalSize: integer('original_size'), // Bytes
    cleanSize: integer('clean_size'), // Bytes
    transcript: text('transcript'), // Full timestamped transcript (JSON)
    status: text('status', {
      enum: ['pending', 'downloading', 'transcribing', 'detecting', 'cutting', 'done', 'error'],
    })
      .notNull()
      .default('pending'),
    errorMessage: text('error_message'),
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    uniqueGuidPerShow: unique().on(table.showId, table.guid),
  }),
)

/**
 * Ads — an individual ad segment detected within an episode. Each ad is a
 * separate record, even when multiple ads are placed back-to-back in a break.
 */
export const ads = sqliteTable('ads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  episodeId: integer('episode_id')
    .notNull()
    .references(() => episodes.id, { onDelete: 'cascade' }),
  showId: integer('show_id')
    .notNull()
    .references(() => shows.id, { onDelete: 'cascade' }),
  startTime: real('start_time').notNull(), // Seconds from episode start
  endTime: real('end_time').notNull(), // Seconds from episode start
  label: text('label', {
    enum: ['ad', 'promo', 'fluff'],
  })
    .notNull()
    .default('ad'),
  company: text('company'), // Advertiser name (e.g., "Curiosity Stream")
  adText: text('ad_text'), // Transcript text of the ad
  reason: text('reason'), // Why the LLM classified this as an ad
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
})

/**
 * Settings — application-level configuration stored as key/value strings.
 * Typed access lives in src/server/lib/settings.ts.
 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export const showsRelations = relations(shows, ({ many }) => ({
  episodes: many(episodes),
  ads: many(ads),
}))

export const episodesRelations = relations(episodes, ({ one, many }) => ({
  show: one(shows, { fields: [episodes.showId], references: [shows.id] }),
  ads: many(ads),
}))

export const adsRelations = relations(ads, ({ one }) => ({
  episode: one(episodes, { fields: [ads.episodeId], references: [episodes.id] }),
  show: one(shows, { fields: [ads.showId], references: [shows.id] }),
}))

export type Show = typeof shows.$inferSelect
export type NewShow = typeof shows.$inferInsert
export type Episode = typeof episodes.$inferSelect
export type NewEpisode = typeof episodes.$inferInsert
export type Ad = typeof ads.$inferSelect
export type NewAd = typeof ads.$inferInsert
export type EpisodeStatus = Episode['status']
export type AdLabel = Ad['label']
