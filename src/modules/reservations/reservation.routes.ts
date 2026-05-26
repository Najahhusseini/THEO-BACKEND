import { Hono } from 'hono'
import { db } from '../../db'
import { sql } from 'drizzle-orm'
import { 
    createReservation,
    getReservations,
    getReservationById,
    updateReservation,
    confirmReservation,
    cancelReservation,
    checkConflicts,
    sendPreArrivalEmails
} from './reservation.service'
import { closeFolio, addFolioItemByStayId } from '../folio/folio.service'   // ✅ ADDED
import { z } from 'zod'
import { eventBus } from '../../events/eventBus'

const reservations = new Hono()

console.log('✅ Reservations routes module LOADED')

// ========== PUBLIC ROUTE (no auth) ==========
reservations.get('/public-test', (c) => {
    return c.text('Reservations router is alive!')
})

// ========== Get calendar data ==========
reservations.get('/calendar', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)

    const start_date = c.req.query('start_date')
    const end_date = c.req.query('end_date')
    
    if (!start_date || !end_date) {
        return c.json({ error: 'start_date and end_date required' }, 400)
    }
    
    try {
        const result = await db.execute(sql`
            SELECT 
                arrival_date,
                departure_date,
                room_type,
                COUNT(*) as bookings
            FROM reservations
            WHERE status = 'confirmed'
              AND arrival_date <= ${end_date}::date
              AND departure_date >= ${start_date}::date
            GROUP BY arrival_date, departure_date, room_type
            ORDER BY arrival_date ASC
        `)
        return c.json(result.rows)
    } catch (err: any) {
        console.error('Calendar error:', err)
        return c.json({ error: err.message }, 500)
    }
})

// ========== Send pre‑arrival emails ==========
reservations.post('/send-prearrival-emails', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    if (!['admin', 'manager', 'reservation_manager'].includes(user.role)) {
        return c.json({ error: 'Forbidden' }, 403)
    }
    const { daysAhead = 3 } = await c.req.json()
    try {
        const result = await sendPreArrivalEmails(user.tenant_id, daysAhead)
        return c.json(result)
    } catch (err: any) {
        console.error('Pre‑arrival email error:', err)
        return c.json({ error: err.message }, 500)
    }
})

// ========== Get all stays ==========
reservations.get('/stays', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    try {
        const result = await db.execute(sql`
            SELECT s.*, r.room_number as room_number, r.room_type
            FROM stays s
            JOIN rooms r ON s.room_number = r.room_number
            WHERE r.tenant_id = ${user.tenantId}
            ORDER BY s.arrival_date ASC
        `)
        return c.json(result.rows)
    } catch (err) {
        console.error(err)
        return c.json({ error: 'Failed to fetch stays' }, 500)
    }
})

// ========== Check‑in a stay ==========
reservations.post('/stays/:stayId/check-in', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    if (!['admin', 'manager', 'reservation_manager', 'frontdesk'].includes(user.role)) {
        return c.json({ error: 'Forbidden' }, 403)
    }

    const { stayId } = c.req.param()
    try {
        const result = await db.transaction(async (tx) => {
            const stayResult = await tx.execute(sql`
                SELECT * FROM stays WHERE id = ${stayId} FOR UPDATE
            `)
            if (stayResult.rows.length === 0) throw new Error('Stay not found')
            const stay = stayResult.rows[0]
            if (stay.status === 'checked_in') throw new Error('Stay already checked in')
            if (stay.status !== 'upcoming') throw new Error(`Invalid stay status: ${stay.status}`)
            await tx.execute(sql`
                UPDATE stays SET status = 'checked_in', updated_at = NOW()
                WHERE id = ${stayId}
            `)
            return stay
        })
        eventBus.emit(user.tenantId, 'guest.checked_in', {
            tenantId: user.tenantId,
            stayId: result.id,
            reservationId: result.reservation_id,
            guestName: result.guest_name,
            roomNumber: result.room_number,
            staffId: user.id || user.staffId,
        })
        return c.json(result)
    } catch (err: any) {
        console.error('Check‑in error:', err)
        return c.json({ error: err.message }, 500)
    }
})

// ========== Toggle key issued ==========
reservations.patch('/stays/:stayId/key', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    if (!['admin', 'manager', 'frontdesk'].includes(user.role)) {
        return c.json({ error: 'Forbidden' }, 403)
    }

    const { stayId } = c.req.param()
    const { key_issued } = await c.req.json()
    if (typeof key_issued !== 'boolean') {
        return c.json({ error: 'key_issued (boolean) required' }, 400)
    }

    try {
        const result = await db.execute(sql`
            UPDATE stays SET key_issued = ${key_issued}, updated_at = NOW()
            WHERE id = ${stayId}
            RETURNING *
        `)
        if (result.rows.length === 0) return c.json({ error: 'Stay not found' }, 404)
        return c.json(result.rows[0])
    } catch (err: any) {
        console.error('Key update error:', err)
        return c.json({ error: err.message }, 500)
    }
})

// ========== Move a stay to a different room ==========
reservations.patch('/stays/:stayId/move-room', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    if (!['admin', 'manager', 'head_housekeeping', 'reservation_manager', 'frontdesk'].includes(user.role)) {
        return c.json({ error: 'Forbidden' }, 403)
    }

    const { stayId } = c.req.param()
    const { roomNumber } = await c.req.json()
    if (!roomNumber) return c.json({ error: 'roomNumber required' }, 400)

    try {
        await db.transaction(async (tx) => {
            const stayResult = await tx.execute(sql`
                SELECT * FROM stays WHERE id = ${stayId} FOR UPDATE
            `)
            if (stayResult.rows.length === 0) throw new Error('Stay not found')
            const currentStay = stayResult.rows[0]

            const roomCheck = await tx.execute(sql`
                SELECT room_number, out_of_order FROM rooms
                WHERE room_number = ${roomNumber} AND tenant_id = ${user.tenantId} FOR UPDATE
            `)
            if (roomCheck.rows.length === 0) throw new Error('Room not found')
            if (roomCheck.rows[0].out_of_order) throw new Error('Room is out of order')

            const overlap = await tx.execute(sql`
                SELECT id FROM stays
                WHERE room_number = ${roomNumber}
                  AND id != ${stayId}
                  AND status != 'checked_out'
                  AND arrival_date <= ${currentStay.departure_date}
                  AND departure_date >= ${currentStay.arrival_date}
            `)
            if (overlap.rows.length > 0) throw new Error('Target room is already booked for those dates')

            await tx.execute(sql`
                UPDATE stays SET room_number = ${roomNumber}, updated_at = NOW()
                WHERE id = ${stayId}
            `)

            eventBus.emit(user.tenantId, 'room.reassigned', {
                tenantId: user.tenantId,
                stayId,
                reservationId: currentStay.reservation_id,
                guestName: currentStay.guest_name,
                previousRoom: currentStay.room_number,
                newRoom: roomNumber,
                staffId: user.id || user.staffId,
            })
        })
        return c.json({ success: true, roomNumber })
    } catch (err: any) {
        console.error('Move room error:', err)
        return c.json({ error: err.message }, 500)
    }
})

// ========== Assign a specific room to a confirmed reservation ==========
reservations.post('/:id/assign-room', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    if (!['admin', 'manager', 'reservation_manager', 'frontdesk'].includes(user.role)) {
        return c.json({ error: 'Forbidden' }, 403)
    }
    
    const { id } = c.req.param()
    const { roomNumber } = await c.req.json()
    if (!roomNumber) return c.json({ error: 'roomNumber required' }, 400)
    
    try {
        await db.transaction(async (tx) => {
            const reservationResult = await tx.execute(sql`
                SELECT * FROM reservations WHERE id = ${id} FOR UPDATE
            `)
            if (reservationResult.rows.length === 0) throw new Error('Reservation not found')
            const reservation = reservationResult.rows[0]
            if (reservation.status !== 'confirmed') throw new Error('Only confirmed reservations can be assigned a room')

            const roomCheck = await tx.execute(sql`
                SELECT room_number, out_of_order FROM rooms
                WHERE room_number = ${roomNumber} AND tenant_id = ${user.tenantId} FOR UPDATE
            `)
            if (roomCheck.rows.length === 0) throw new Error('Room not found')
            if (roomCheck.rows[0].out_of_order) throw new Error('Room is out of order')

            const overlap = await tx.execute(sql`
                SELECT id FROM stays
                WHERE room_number = ${roomNumber}
                  AND reservation_id != ${id}
                  AND status != 'checked_out'
                  AND arrival_date <= ${reservation.departure_date}
                  AND departure_date >= ${reservation.arrival_date}
            `)
            if (overlap.rows.length > 0) throw new Error('Room already booked for those dates')

            const existingStay = await tx.execute(sql`
                SELECT id FROM stays WHERE reservation_id = ${id}
            `)
            if (existingStay.rows.length > 0) {
                await tx.execute(sql`
                    UPDATE stays SET room_number = ${roomNumber}, updated_at = NOW()
                    WHERE reservation_id = ${id}
                `)
            } else {
                await tx.execute(sql`
                    INSERT INTO stays (reservation_id, guest_name, guest_email, room_number, arrival_date, departure_date, status, created_at, updated_at)
                    VALUES (${id}, ${reservation.guest_name}, ${reservation.guest_email}, ${roomNumber}, ${reservation.arrival_date}, ${reservation.departure_date}, 'upcoming', NOW(), NOW())
                `)
            }

            eventBus.emit(user.tenantId, 'room.assigned', {
                tenantId: user.tenantId,
                reservationId: id,
                roomNumber,
                guestName: reservation.guest_name,
                staffId: user.id || user.staffId,
            })
        })
        return c.json({ success: true, roomNumber })
    } catch (err: any) {
        console.error('Assign room error:', err)
        return c.json({ error: err.message }, 500)
    }
})

// ========== Check for conflicts ==========
reservations.post('/check-conflicts', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)

    const body = await c.req.json()
    const schema = z.object({
        arrival_date: z.string().transform(d => new Date(d)),
        departure_date: z.string().transform(d => new Date(d)),
        room_type: z.string().min(1),
        exclude_id: z.string().optional()
    })
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
        return c.json({ error: 'Invalid request', details: parsed.error }, 400)
    }
    const hasConflict = await checkConflicts(
        parsed.data.arrival_date,
        parsed.data.departure_date,
        parsed.data.room_type,
        user.tenantId,
        parsed.data.exclude_id
    )
    return c.json({ hasConflict })
})

// ========== Create a new reservation ==========
reservations.post('/', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)

    const body = await c.req.json()
    const schema = z.object({
        guest_name: z.string().min(1),
        guest_email: z.string().email().optional(),
        guest_phone: z.string().optional(),
        arrival_date: z.string().transform(d => new Date(d)),
        departure_date: z.string().transform(d => new Date(d)),
        room_type: z.string().nullable().optional(),
        number_of_guests: z.number().min(1).default(1),
        number_of_rooms: z.number().min(1).default(1),
        special_requests: z.string().optional(),
        status: z.enum(['pending_review', 'confirmed']).optional().default('pending_review')
    })
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
        return c.json({ error: 'Invalid request', details: parsed.error }, 400)
    }

    try {
        const reservation = await createReservation({
            ...parsed.data,
            status: parsed.data.status,
            tenantId: user.tenantId,
        })
        eventBus.emit(user.tenantId, 'reservation.created', {
            tenantId: user.tenantId,
            reservation,
            staffId: user.id || user.staffId,
        })
        if (reservation.status === 'confirmed') {
            eventBus.emit(user.tenantId, 'reservation.confirmed', {
                tenantId: user.tenantId,
                reservation,
                staffId: user.id || user.staffId,
            })
        }
        return c.json(reservation, 201)
    } catch (err: any) {
        console.error('Create error:', err)
        return c.json({ error: err.message }, 500)
    }
})

// ========== Get all reservations ==========
reservations.get('/', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)

    const status = c.req.query('status')
    const start_date = c.req.query('start_date')
    const end_date = c.req.query('end_date')
    const room_type = c.req.query('room_type')
    try {
        const reservationsList = await getReservations({
            status: status || undefined,
            start_date: start_date ? new Date(start_date) : undefined,
            end_date: end_date ? new Date(end_date) : undefined,
            room_type: room_type || undefined
        })
        return c.json(reservationsList)
    } catch (err: any) {
        console.error('Get all error:', err)
        return c.json({ error: err.message }, 500)
    }
})

// ========== Get a single reservation ==========
reservations.get('/:id', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)

    const { id } = c.req.param()
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) return c.json({ error: 'Invalid reservation ID format' }, 400)
    try {
        const reservation = await getReservationById(id)
        if (!reservation) return c.json({ error: 'Reservation not found' }, 404)
        return c.json(reservation)
    } catch (err: any) {
        console.error('Get by ID error:', err)
        return c.json({ error: err.message }, 500)
    }
})

// ========== Update a reservation ==========
reservations.put('/:id', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)

    const { id } = c.req.param()
    const body = await c.req.json()
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) return c.json({ error: 'Invalid reservation ID format' }, 400)
    try {
        const updated = await updateReservation(id, body)
        if (!updated) return c.json({ error: 'Reservation not found' }, 404)
        eventBus.emit(user.tenantId, 'reservation.updated', {
            tenantId: user.tenantId,
            reservation: updated,
            staffId: user.id || user.staffId,
        })
        return c.json(updated)
    } catch (err: any) {
        console.error('Update error:', err)
        return c.json({ error: err.message }, 500)
    }
})

// ========== Confirm a reservation ==========
reservations.post('/:id/confirm', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)

    const { id } = c.req.param()
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) return c.json({ error: 'Invalid reservation ID format' }, 400)
    try {
        const confirmed = await confirmReservation(id)
        eventBus.emit(user.tenantId, 'reservation.confirmed', {
            tenantId: user.tenantId,
            reservation: confirmed,
            staffId: user.id || user.staffId,
        })
        return c.json(confirmed)
    } catch (err: any) {
        console.error('Confirm error:', err)
        return c.json({ error: err.message }, 500)
    }
})

// ========== Cancel a reservation ==========
reservations.post('/:id/cancel', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)

    const { id } = c.req.param()
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) return c.json({ error: 'Invalid reservation ID format' }, 400)
    try {
        const cancelled = await cancelReservation(id)
        eventBus.emit(user.tenantId, 'reservation.cancelled', {
            tenantId: user.tenantId,
            reservation: cancelled,
            staffId: user.id || user.staffId,
        })
        return c.json(cancelled)
    } catch (err: any) {
        console.error('Cancel error:', err)
        return c.json({ error: err.message }, 500)
    }
})

// ========== Check‑out a stay (with folio closure) ==========
reservations.post('/stays/:stayId/check-out', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    if (!['admin', 'manager', 'frontdesk'].includes(user.role)) {
        return c.json({ error: 'Forbidden' }, 403)
    }

    const { stayId } = c.req.param()
    try {
        await db.transaction(async (tx) => {
            const stayResult = await tx.execute(sql`
                SELECT * FROM stays WHERE id = ${stayId} FOR UPDATE
            `)
            if (stayResult.rows.length === 0) throw new Error('Stay not found')
            const stay = stayResult.rows[0]
            if (stay.status !== 'checked_in') throw new Error(`Stay not checked in (status: ${stay.status})`)
            await tx.execute(sql`
                UPDATE stays SET status = 'checked_out', updated_at = NOW()
                WHERE id = ${stayId}
            `)
            const closeResult = await closeFolio(stayId, user.tenantId)
            if (!closeResult.success) throw new Error('Failed to close folio')
            const roomNumber = stay.room_number
            await tx.execute(sql`
                UPDATE rooms SET status = 'dirty', last_status_change = NOW()
                WHERE room_number = ${roomNumber} AND tenant_id = ${user.tenantId}
            `)
            await tx.execute(sql`
                INSERT INTO cleaning_requests (room_id, status, priority, requested_by, created_at)
                SELECT id, 'pending', 'high', ${user.id || user.staffId}, NOW()
                FROM rooms
                WHERE room_number = ${roomNumber} AND tenant_id = ${user.tenantId}
                ON CONFLICT (room_id, status) DO NOTHING
            `)
        })
        eventBus.emit(user.tenantId, 'guest.checked_out', {
            tenantId: user.tenantId,
            stayId,
            reservationId: null,
            guestName: null,
            roomNumber: null,
            staffId: user.id || user.staffId,
        })
        return c.json({ success: true })
    } catch (err: any) {
        console.error('Check‑out error:', err)
        return c.json({ error: err.message }, 500)
    }
})

// ========== EXTEND STAY ==========
reservations.post('/stays/:stayId/extend', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    if (!['admin', 'manager', 'frontdesk'].includes(user.role)) {
        return c.json({ error: 'Forbidden' }, 403)
    }

    const { stayId } = c.req.param()
    const { newDepartureDate } = await c.req.json()
    if (!newDepartureDate) return c.json({ error: 'newDepartureDate required' }, 400)

    try {
        await db.transaction(async (tx) => {
            // Lock the stay
            const stayResult = await tx.execute(sql`
                SELECT * FROM stays WHERE id = ${stayId} FOR UPDATE
            `)
            if (stayResult.rows.length === 0) throw new Error('Stay not found')
            const stay = stayResult.rows[0]
            if (stay.status !== 'checked_in') {
                throw new Error('Can only extend a checked‑in stay')
            }

            const newDeparture = new Date(newDepartureDate)
            const currentDeparture = new Date(stay.departure_date)
            if (newDeparture <= currentDeparture) {
                throw new Error('New departure date must be after current departure date')
            }

            // Update stay departure date
            await tx.execute(sql`
                UPDATE stays SET departure_date = ${newDepartureDate}, updated_at = NOW()
                WHERE id = ${stayId}
            `)

            // Also update the original reservation if linked
            if (stay.reservation_id) {
                await tx.execute(sql`
                    UPDATE reservations SET departure_date = ${newDepartureDate}, updated_at = NOW()
                    WHERE id = ${stay.reservation_id}
                `)
            }

            // Calculate extra nights and add folio charge
            const roomResult = await tx.execute(sql`
                SELECT price_per_night FROM rooms WHERE room_number = ${stay.room_number} AND tenant_id = ${user.tenantId}
            `)
            const pricePerNight = parseFloat(roomResult.rows[0]?.price_per_night) || 0
            const extraNights = Math.ceil((newDeparture.getTime() - currentDeparture.getTime()) / (1000 * 60 * 60 * 24))
            if (extraNights > 0 && pricePerNight > 0) {
                const extraAmount = extraNights * pricePerNight
                const description = `Stay extension: +${extraNights} night(s) at $${pricePerNight}/night`
                await addFolioItemByStayId(stayId, description, extraAmount, 'room_charge', tx)
            }
        })
        return c.json({ success: true })
    } catch (err: any) {
        console.error('Extend stay error:', err)
        return c.json({ error: err.message }, 500)
    }
})

// ========== Update reservation notes ==========
reservations.patch('/:id/notes', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    if (!['admin', 'manager', 'reservation_manager', 'frontdesk'].includes(user.role)) {
        return c.json({ error: 'Forbidden' }, 403)
    }

    const { id } = c.req.param()
    const { notes } = await c.req.json()
    if (!Array.isArray(notes)) return c.json({ error: 'notes must be an array' }, 400)

    try {
        await db.execute(sql`
            UPDATE reservations SET notes = ${JSON.stringify(notes)}::jsonb WHERE id = ${id}
        `)
        return c.json({ success: true })
    } catch (err: any) {
        console.error('Notes update error:', err)
        return c.json({ error: err.message }, 500)
    }
})

export default reservations