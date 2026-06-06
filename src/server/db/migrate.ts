import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from './index.js'

/**
 * Apply pending migrations from ./drizzle. Run via `pnpm db:migrate` and also
 * called on server startup so a fresh container self-initializes its schema.
 */
export function runMigrations(): void {
  migrate(db, { migrationsFolder: './drizzle' })
}

// Allow running directly: `tsx src/server/db/migrate.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
  console.log('Migrations applied.')
}
