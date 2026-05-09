import { Hono } from 'hono'
import { db } from '../../db'
import { sql } from 'drizzle-orm'

const guests = new Hono()

// GET /api/guests/profiles – aggregated guest profiles (unified by guest_id)
guests.get('/profiles', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const result = await db.execute(sql`
    WITH guest_data AS (
      SELECT
        g.id AS guest_id,
        g.name AS guest_name,
        g.email AS guest_email,
        g.phone AS guest_phone,
        COUNT(DISTINCT r.id)::int AS total_reservations,
        COUNT(DISTINCT s.id)::int AS total_stays,
        MAX(r.arrival_date) AS last_arrival,
        MAX(r.departure_date) AS last_departure,
        BOOL_OR(s.status = 'checked_in') AS is_in_house,
        BOOL_OR(s.status = 'upcoming') AS is_expected,
        COALESCE(SUM(fi.total), 0)::numeric AS total_folio_amount
      FROM guests g
      LEFT JOIN reservations r ON r.guest_id = g.id AND r.tenant_id = ${user.tenantId}
      LEFT JOIN stays s ON s.reservation_id = r.id
      LEFT JOIN folios f ON f.stay_id = s.id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(amount), 0) AS total FROM folio_items WHERE folio_id = f.id
      ) fi ON true
      WHERE g.tenant_id = ${user.tenantId}
      GROUP BY g.id
    )
    SELECT *
    FROM guest_data
    ORDER BY is_in_house DESC, is_expected DESC, last_arrival DESC NULLS LAST
  `)

  return c.json(result.rows)
})

// GET /api/guests/:guestId/details – full detail for a single guest
guests.get('/:guestId/details', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  const { guestId } = c.req.param()

  const reservations = await db.execute(sql`
    SELECT r.*, s.status as stay_status, s.room_number, s.arrival_date as stay_arrival, s.departure_date as stay_departure, f.id as folio_id
    FROM reservations r
    LEFT JOIN stays s ON s.reservation_id = r.id
    LEFT JOIN folios f ON f.stay_id = s.id
    WHERE r.guest_id = ${guestId}
    ORDER BY r.arrival_date DESC
  `)

  return c.json(reservations.rows)
})

export default guests