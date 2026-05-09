import { db } from '../../db'
import { sql } from 'drizzle-orm'
import nodemailer from 'nodemailer'

// ================== EMAIL TRANSPORTER ==================
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
})

// ================== EXISTING INTERFACES ==================
export interface CreateReservationInput {
    guest_name: string
    guest_email?: string
    guest_phone?: string
    source?: string
    arrival_date: Date
    departure_date: Date
    room_type?: string | null
    number_of_guests?: number
    number_of_rooms?: number
    special_requests?: string
    is_group_booking?: boolean
    group_id?: string
    status?: 'pending_review' | 'confirmed'
    tenantId?: string
}

export interface UpdateReservationInput {
    guest_name?: string
    guest_email?: string
    guest_phone?: string
    arrival_date?: Date
    departure_date?: Date
    room_type?: string | null
    number_of_guests?: number
    number_of_rooms?: number
    special_requests?: string
    status?: string
}

// ================== GUEST MATCHING HELPER ==================
async function getOrCreateGuest(
    tenantId: string,
    name: string,
    email?: string,
    phone?: string
): Promise<string> {
    // 1. Try to find an existing guest by email (most reliable)
    if (email) {
        const existing = await db.execute(sql`
            SELECT id FROM guests
            WHERE tenant_id = ${tenantId} AND email = ${email}
            LIMIT 1
        `)
        if (existing.rows.length > 0) {
            return existing.rows[0].id
        }
    }

    // 2. Fallback – match by name if no email
    const byName = await db.execute(sql`
        SELECT id FROM guests
        WHERE tenant_id = ${tenantId} AND name = ${name}
        LIMIT 1
    `)
    if (byName.rows.length > 0) {
        return byName.rows[0].id
    }

    // 3. Create a new guest record
    const insert = await db.execute(sql`
        INSERT INTO guests (id, tenant_id, name, email, phone)
        VALUES (gen_random_uuid(), ${tenantId}, ${name}, ${email || null}, ${phone || null})
        RETURNING id
    `)
    return insert.rows[0].id
}

// ================== CREATE RESERVATION ==================
export async function createReservation(data: CreateReservationInput) {
    const now = new Date()
    const status = data.status === 'confirmed' ? 'confirmed' : 'pending_review'

    // Convert empty string to null for room_type
    let room_type: string | null = null
    if (data.room_type !== undefined) {
        room_type = data.room_type?.trim() === '' ? null : data.room_type
    }

    // ✅ Unify guest – finds or creates a guest record
    const guestId = data.tenantId
        ? await getOrCreateGuest(data.tenantId, data.guest_name, data.guest_email, data.guest_phone)
        : null

    const result = await db.execute(sql`
        INSERT INTO reservations (
            guest_name, guest_email, guest_phone, source,
            arrival_date, departure_date, room_type,
            number_of_guests, number_of_rooms, special_requests,
            is_group_booking, group_id, status, tenant_id,
            guest_id, created_at, updated_at, confirmed_at
        ) VALUES (
            ${data.guest_name}, ${data.guest_email || null}, ${data.guest_phone || null}, ${data.source || 'manual'},
            ${data.arrival_date}, ${data.departure_date}, ${room_type},
            ${data.number_of_guests || 1}, ${data.number_of_rooms || 1}, ${data.special_requests || null},
            ${data.is_group_booking || false}, ${data.group_id || null}, ${status},
            ${data.tenantId || null}, ${guestId},
            NOW(), NOW(),
            ${status === 'confirmed' ? now : null}
        )
        RETURNING *
    `)
    const reservation = result.rows[0]

    if (status === 'confirmed') {
        await db.execute(sql`
            INSERT INTO stays (
                reservation_id, guest_name, guest_email,
                arrival_date, departure_date, status, created_at, updated_at
            ) VALUES (
                ${reservation.id}, ${reservation.guest_name}, ${reservation.guest_email},
                ${reservation.arrival_date}, ${reservation.departure_date}, 'upcoming', NOW(), NOW()
            )
        `)
    }

    return reservation
}

// ================== GET RESERVATIONS ==================
export async function getReservations(filters?: {
    status?: string
    start_date?: Date
    end_date?: Date
    room_type?: string
}) {
    let query = sql`SELECT * FROM reservations WHERE 1=1`

    if (filters?.status) {
        query = sql`${query} AND status = ${filters.status}`
    }
    if (filters?.start_date) {
        query = sql`${query} AND arrival_date >= ${filters.start_date}`
    }
    if (filters?.end_date) {
        query = sql`${query} AND departure_date <= ${filters.end_date}`
    }
    if (filters?.room_type) {
        query = sql`${query} AND room_type = ${filters.room_type}`
    }

    query = sql`${query} ORDER BY arrival_date ASC`
    const result = await db.execute(query)
    return result.rows
}

export async function getReservationById(id: string) {
    const result = await db.execute(sql`
        SELECT * FROM reservations WHERE id = ${id}
    `)
    return result.rows[0]
}

// ================== UPDATE RESERVATION ==================
export async function updateReservation(id: string, data: UpdateReservationInput) {
    const fields = []
    const values: any[] = []
    let paramIndex = 1

    if (data.guest_name !== undefined) {
        fields.push(`guest_name = $${paramIndex++}`)
        values.push(data.guest_name)
    }
    if (data.guest_email !== undefined) {
        fields.push(`guest_email = $${paramIndex++}`)
        values.push(data.guest_email)
    }
    if (data.guest_phone !== undefined) {
        fields.push(`guest_phone = $${paramIndex++}`)
        values.push(data.guest_phone)
    }
    if (data.arrival_date !== undefined) {
        fields.push(`arrival_date = $${paramIndex++}`)
        values.push(data.arrival_date)
    }
    if (data.departure_date !== undefined) {
        fields.push(`departure_date = $${paramIndex++}`)
        values.push(data.departure_date)
    }
    if (data.room_type !== undefined) {
        fields.push(`room_type = $${paramIndex++}`)
        values.push(data.room_type)
    }
    if (data.number_of_guests !== undefined) {
        fields.push(`number_of_guests = $${paramIndex++}`)
        values.push(data.number_of_guests)
    }
    if (data.number_of_rooms !== undefined) {
        fields.push(`number_of_rooms = $${paramIndex++}`)
        values.push(data.number_of_rooms)
    }
    if (data.special_requests !== undefined) {
        fields.push(`special_requests = $${paramIndex++}`)
        values.push(data.special_requests)
    }
    if (data.status !== undefined) {
        fields.push(`status = $${paramIndex++}`)
        values.push(data.status)
    }

    fields.push(`updated_at = NOW()`)
    values.push(id)

    const result = await db.execute(sql`
        UPDATE reservations 
        SET ${sql.raw(fields.join(', '))}
        WHERE id = $${paramIndex}
        RETURNING *
    `)
    return result.rows[0]
}

// ================== CONFIRM RESERVATION ==================
export async function confirmReservation(id: string) {
    const reservation = await getReservationById(id)
    if (!reservation) throw new Error('Reservation not found')

    const updated = await db.execute(sql`
        UPDATE reservations 
        SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
    `)

    await db.execute(sql`
        INSERT INTO stays (
            reservation_id, guest_name, guest_email,
            arrival_date, departure_date, status, created_at, updated_at
        ) VALUES (
            ${id}, ${reservation.guest_name}, ${reservation.guest_email},
            ${reservation.arrival_date}, ${reservation.departure_date}, 'upcoming', NOW(), NOW()
        )
    `)

    return updated.rows[0]
}

// ================== CANCEL RESERVATION ==================
export async function cancelReservation(id: string) {
    const result = await db.execute(sql`
        UPDATE reservations 
        SET status = 'cancelled', updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
    `)
    return result.rows[0]
}

// ================== CONFLICT DETECTION (FIXED) ==================
export async function checkConflicts(
    arrival_date: Date,
    departure_date: Date,
    room_type: string,
    tenantId: string,
    excludeReservationId?: string
) {
    const roomCountResult = await db.execute(sql`
        SELECT COUNT(*)::int as total
        FROM rooms
        WHERE room_type = ${room_type}
          AND tenant_id = ${tenantId}
          AND (out_of_order IS NULL OR out_of_order = false)
    `)
    const totalRooms = roomCountResult.rows[0]?.total || 0

    if (totalRooms === 0) return true

    let overlapQuery = sql`
        SELECT COUNT(*)::int as count
        FROM reservations
        WHERE status = 'confirmed'
          AND room_type = ${room_type}
          AND arrival_date <= ${departure_date}::date
          AND departure_date >= ${arrival_date}::date
    `
    if (excludeReservationId) {
        overlapQuery = sql`${overlapQuery} AND id != ${excludeReservationId}`
    }
    const overlapResult = await db.execute(overlapQuery)
    const overlappingBookings = overlapResult.rows[0]?.count || 0

    return overlappingBookings >= totalRooms
}

// ================== PRE‑ARRIVAL EMAILS ==================
export async function sendPreArrivalEmails(tenantId: string, daysAhead: number = 3) {
    const targetDate = new Date()
    targetDate.setDate(targetDate.getDate() + daysAhead)
    const targetDateStr = targetDate.toISOString().split('T')[0]

    const result = await db.execute(sql`
        SELECT id, guest_name, guest_email, arrival_date, departure_date, room_type, number_of_rooms
        FROM reservations
        WHERE status = 'confirmed'
          AND arrival_date = ${targetDateStr}
          AND tenant_id = ${tenantId}
    `)

    const sent: string[] = []
    for (const r of result.rows) {
        if (!r.guest_email) continue
        const mailOptions = {
            from: `"THEO Hotel" <${process.env.SMTP_USER}>`,
            to: r.guest_email,
            subject: `Your upcoming stay at THEO Hotel – Arrival ${new Date(r.arrival_date).toLocaleDateString()}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px;">
                    <h2>Dear ${r.guest_name},</h2>
                    <p>We look forward to welcoming you on <strong>${new Date(r.arrival_date).toLocaleDateString()}</strong>.</p>
                    <p>Your booking details:</p>
                    <ul>
                        <li><strong>Room type:</strong> ${r.room_type || 'Not specified'}</li>
                        <li><strong>Number of rooms:</strong> ${r.number_of_rooms}</li>
                        <li><strong>Departure:</strong> ${new Date(r.departure_date).toLocaleDateString()}</li>
                    </ul>
                    <p>If you have any special requests, please reply to this email.</p>
                    <p>Safe travels,<br/>THEO Team</p>
                </div>
            `,
        }
        await transporter.sendMail(mailOptions)
        sent.push(r.id)
    }
    return { sent, count: sent.length }
}