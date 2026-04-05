import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, closeDb } from './index'
import 'dotenv/config'

async function runMigration() {
  console.log('Running migrations...')
  await migrate(db, { migrationsFolder: './drizzle' })
  console.log('Migrations completed!')
  await closeDb()
  process.exit(0)
}

runMigration().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})