import { db } from './src/db'
import { sql } from 'drizzle-orm'

async function main() {
  await db.execute(sql`
    INSERT INTO emails (id, sender, subject, body, parsed_data, confidence_score, status, created_at)
    VALUES (
      gen_random_uuid(),
      'John Doe <john@example.com>',
      'Hotel Reservation Request',
      'Hi, I would like to book a Standard room from May 4th to May 6th. Thank you!',
      '{
        "guest_name": "John Doe",
        "arrival_date": "2026-05-04",
        "departure_date": "2026-05-06",
        "number_of_rooms": 1,
        "is_group": false,
        "confidence": 0.9
      }',
      0.9,
      'pending',
      NOW()
    )
  `)

  console.log('✅ Test email inserted successfully!')
  process.exit(0)
}

main().catch((err) => {
  console.error('Failed to insert test email:', err)
  process.exit(1)
})