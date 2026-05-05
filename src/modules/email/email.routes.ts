import { Hono } from 'hono'
import { db } from '../../db'
import { sql } from 'drizzle-orm'
import { getEmails, updateEmailParsedData, markEmailProcessed, storeEmail } from './email.service'
import { z } from 'zod'
import nodemailer from 'nodemailer'

const emailRouter = new Hono()

// Get all emails (with optional status filter)
emailRouter.get('/', async (c) => {
    const user = c.get('user')
    if (!['admin', 'manager', 'reservation_manager'].includes(user?.role)) {
        return c.json({ error: 'Unauthorized' }, 403)
    }
    const status = c.req.query('status')
    const emails = await getEmails(status)
    return c.json(emails)
})

// Manually add a test email (useful for development)
emailRouter.post('/', async (c) => {
    const user = c.get('user')
    if (!['admin', 'manager', 'reservation_manager'].includes(user?.role)) {
        return c.json({ error: 'Unauthorized' }, 403)
    }
    const { sender, subject, body } = await c.req.json()
    const result = await storeEmail(sender, subject, body)
    return c.json(result, 201)
})

// Update parsed data for an email
emailRouter.put('/:id/parsed', async (c) => {
    const user = c.get('user')
    if (!['admin', 'manager', 'reservation_manager'].includes(user?.role)) {
        return c.json({ error: 'Unauthorized' }, 403)
    }
    const { id } = c.req.param()
    const parsedData = await c.req.json()
    await updateEmailParsedData(id, parsedData)
    return c.json({ success: true })
})

// Mark email as processed and optionally create a reservation
emailRouter.post('/:id/process', async (c) => {
    const user = c.get('user')
    if (!['admin', 'manager', 'reservation_manager'].includes(user?.role)) {
        return c.json({ error: 'Unauthorized' }, 403)
    }
    const { id } = c.req.param()
    const { createReservation, reservationData } = await c.req.json()

    const result = await markEmailProcessed(id, createReservation, reservationData)

    // ✨ Create notification for reservation manager
    if (createReservation && result && result.id) {
        await db.execute(sql`
            INSERT INTO notifications (id, staff_id, type, title, message, created_at)
            VALUES (
                gen_random_uuid(),
                ${user.id},
                'new_reservation',
                'New Email Reservation',
                ${`Reservation for ${result.guest_name || 'guest'} created from email`},
                NOW()
            )
        `)
    }

    return c.json(result)
})

// ========== Generate a draft email for a waitlisted reservation ==========
emailRouter.post('/draft', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    if (!['admin', 'manager', 'reservation_manager'].includes(user.role)) {
        return c.json({ error: 'Forbidden' }, 403)
    }

    const { reservationId, customMessage } = await c.req.json()
    const reservation = await db.execute(sql`SELECT * FROM reservations WHERE id = ${reservationId}`)
    if (reservation.rows.length === 0) return c.json({ error: 'Reservation not found' }, 404)
    const res = reservation.rows[0]

    let subject = `Booking update for ${res.guest_name}`
    let body = `Dear ${res.guest_name},\n\n`

    if (res.status === 'date_change_requested' && res.proposed_arrival && res.proposed_departure) {
        body += `We have received your request to change dates.\n`
        body += `Original dates: ${res.arrival_date ? res.arrival_date.split('T')[0] : 'N/A'} to ${res.departure_date ? res.departure_date.split('T')[0] : 'N/A'}\n`
        body += `Proposed new dates: ${res.proposed_arrival.split('T')[0]} to ${res.proposed_departure.split('T')[0]}\n`
        subject = `Date change request for reservation #${reservationId.slice(0,8)}`
    } else if (res.status === 'waitlist') {
        body += `Your booking with us is currently on waitlist.\n`
        body += `Original dates: ${res.arrival_date ? res.arrival_date.split('T')[0] : 'N/A'} to ${res.departure_date ? res.departure_date.split('T')[0] : 'N/A'}\n`
        subject = `Waitlist status for reservation #${reservationId.slice(0,8)}`
    } else {
        body += `We are writing to update you about your reservation.\n`
    }

    body += `If you have any questions, please reply to this email.\n\nThank you,\nTHEO Hotel Team`

    if (customMessage) {
        body = customMessage
    }

    const result = await db.execute(sql`
        INSERT INTO emails (id, sender, subject, body, parsed_data, confidence_score, status, created_at)
        VALUES (
            gen_random_uuid(),
            ${'reservations@theohotel.com'},
            ${subject},
            ${body},
            ${JSON.stringify({ reservation_id: reservationId, guest_name: res.guest_name, action: res.status })},
            1.0,
            'draft',
            NOW()
        )
        RETURNING *
    `)
    return c.json(result.rows[0], 201)
})

// ========== Send a draft email ==========
emailRouter.post('/:id/send', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    if (!['admin', 'manager', 'reservation_manager'].includes(user.role)) {
        return c.json({ error: 'Forbidden' }, 403)
    }

    const { id } = c.req.param()
    const draft = await db.execute(sql`SELECT * FROM emails WHERE id = ${id} AND status = 'draft'`)
    if (draft.rows.length === 0) return c.json({ error: 'Draft not found' }, 404)
    const email = draft.rows[0]

    let guestEmail = ''
    if (email.parsed_data?.reservation_id) {
        const res = await db.execute(sql`SELECT guest_email FROM reservations WHERE id = ${email.parsed_data.reservation_id}`)
        if (res.rows.length > 0) guestEmail = res.rows[0].guest_email
    }

    if (!guestEmail) return c.json({ error: 'Guest email not found' }, 400)

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    })

    try {
        await transporter.sendMail({
            from: `"THEO Hotel" <${process.env.SMTP_USER}>`,
            to: guestEmail,
            subject: email.subject,
            html: email.body.replace(/\n/g, '<br>'),
        })
        await db.execute(sql`UPDATE emails SET status = 'sent', updated_at = NOW() WHERE id = ${id}`)
        return c.json({ success: true })
    } catch (err: any) {
        console.error('Send error:', err)
        return c.json({ error: err.message }, 500)
    }
})

export default emailRouter