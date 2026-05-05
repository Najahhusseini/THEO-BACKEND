import { db } from './src/db'
import { sql } from 'drizzle-orm'

async function main() {
  const today = new Date().toISOString().split('T')[0]
  const departure = new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0]
  const body = `Hello! I would like to book a Deluxe room from ${today} to ${departure}. Thank you!`
  const parsedData = {
    guest_name: 'Sarah Connor',
    arrival_date: today,
    departure_date: departure,
    number_of_rooms: 1,
    is_group: false,
    confidence: 0.92
  }
  const parsedJson = JSON.stringify(parsedData)

  await db.execute(sql`
    INSERT INTO emails (id, sender, subject, body, parsed_data, confidence_score, status, created_at)
    VALUES (
      gen_random_uuid(),
      'Sarah Connor <sarah@example.com>',
      'Booking request for this week',
      ${body}::text,
      ${parsedJson}::json,
      0.92,
      'pending',
      NOW()
    )
  `)

  console.log('✅ Test email inserted for', today)
  process.exit(0)
}

main().catch((err) => {
  console.error('Failed:', err)
  process.exit(1)
})