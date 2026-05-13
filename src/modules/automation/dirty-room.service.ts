import { db } from '../../db'
import { sql } from 'drizzle-orm'

/**
 * Runs once every morning at 6am.
 * Marks all currently occupied rooms as “dirty”
 * and creates cleaning requests if they don't already exist.
 */
export async function markOccupiedRoomsDirty() {
  console.log('⏰ Running 6am dirty‑room automation...')

  const occupiedRooms = await db.execute(sql`
    SELECT r.id, r.room_number, r.tenant_id
    FROM rooms r
    JOIN stays s ON r.room_number = s.room_number
    WHERE s.status = 'checked_in'
      AND r.cleaning_status NOT IN ('dirty', 'cleaning')
  `)

  let count = 0
  for (const room of occupiedRooms.rows) {
    // Mark room dirty
    await db.execute(sql`
      UPDATE rooms SET cleaning_status = 'dirty', last_cleaning_update = NOW()
      WHERE id = ${room.id}
    `)

    // Create cleaning request if not already exists
    const existing = await db.execute(sql`
      SELECT id FROM cleaning_requests
      WHERE room_id = ${room.id}
        AND status IN ('pending','assigned','in_progress')
    `)
    if (existing.rows.length === 0) {
      await db.execute(sql`
        INSERT INTO cleaning_requests (room_id, request_type, notes, status)
        VALUES (${room.id}, 'stay_over', 'Auto-created (6am daily)', 'pending')
      `)
    }
    count++
  }

  console.log(`✅ Marked ${count} occupied rooms as dirty.`)
}