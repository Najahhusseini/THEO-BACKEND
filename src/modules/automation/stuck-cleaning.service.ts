import { db } from '../../db'
import { sql } from 'drizzle-orm'

export async function checkStuckCleaningRooms() {
    const result = await db.execute(sql`
        SELECT id, room_number, last_status_change 
        FROM rooms 
        WHERE status = 'cleaning' 
          AND last_status_change < NOW() - INTERVAL '2 hours'
    `)
    const stuckRooms = result.rows
    if (stuckRooms.length > 0) {
        console.warn(`⚠️ Found ${stuckRooms.length} rooms stuck in cleaning status:`, stuckRooms.map(r => r.room_number).join(', '))
        // You can integrate notification system here
        // For now, auto‑reset to dirty (optional)
        // await db.execute(sql`UPDATE rooms SET status = 'dirty' WHERE id IN (${stuckRooms.map(r => r.id)})`);
    }
    return stuckRooms
}