import { db } from '../../db'
import { sql } from 'drizzle-orm'
import { closeFolio } from '../folio/folio.service'

/**
 * Automatically check out stays whose departure date has passed.
 * Also mark rooms as dirty and create cleaning requests.
 */
export async function autoCheckoutOverdueStays() {
    const today = new Date().toISOString().split('T')[0]

    // Find all checked‑in stays with departure_date < today
    const overdueStays = await db.execute(sql`
        SELECT s.id, s.room_number, s.guest_name, s.tenant_id
        FROM stays s
        WHERE s.status = 'checked_in'
          AND s.departure_date < ${today}
    `)

    let checkedOutCount = 0
    for (const stay of overdueStays.rows) {
        try {
            // Use the existing closeFolio function (idempotent, transaction-safe)
            await closeFolio(stay.id, stay.tenant_id)
            
            // Update stay status (closeFolio does not update stay status, only folio)
            await db.execute(sql`
                UPDATE stays SET status = 'checked_out', updated_at = NOW()
                WHERE id = ${stay.id}
            `)
            
            // Mark room as dirty (in case closeFolio didn't, but it does)
            await db.execute(sql`
                UPDATE rooms SET status = 'dirty', last_status_change = NOW()
                WHERE room_number = ${stay.room_number} AND tenant_id = ${stay.tenant_id}
            `)
            
            // Create a cleaning request
            await db.execute(sql`
                INSERT INTO cleaning_requests (room_id, status, priority, created_at)
                SELECT id, 'pending', 'high', NOW()
                FROM rooms
                WHERE room_number = ${stay.room_number} AND tenant_id = ${stay.tenant_id}
                ON CONFLICT (room_id, status) DO NOTHING
            `)
            
            checkedOutCount++
            console.log(`🕒 Auto-checked out stay ${stay.id} (Room ${stay.room_number})`)
        } catch (err) {
            console.error(`Failed to auto-checkout stay ${stay.id}:`, err)
        }
    }
    
    if (checkedOutCount > 0) {
        console.log(`✅ Auto-checked out ${checkedOutCount} overdue stays.`)
    }
    return { checkedOutCount }
}

/**
 * Optional: Handle no‑show reservations (arrival_date < today but status = 'upcoming' or 'confirmed')
 * For now, just log a warning. Future: mark as 'no_show' and release rooms.
 */
export async function warnOverdueArrivals() {
    const today = new Date().toISOString().split('T')[0]
    const overdueArrivals = await db.execute(sql`
        SELECT id, guest_name, arrival_date, status
        FROM stays
        WHERE status IN ('upcoming', 'confirmed')
          AND arrival_date < ${today}
    `)
    if (overdueArrivals.rows.length > 0) {
        console.warn(`⚠️ ${overdueArrivals.rows.length} stays have missed arrival date:`, overdueArrivals.rows.map(r => `${r.guest_name} (${r.arrival_date})`).join(', '))
        // Optional: automatically cancel or mark no_show
    }
}