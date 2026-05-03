import { db } from '../../db'
import { sql } from 'drizzle-orm'

interface ExtractedData {
    guest_name: string | null
    arrival_date: Date | null
    departure_date: Date | null
    number_of_rooms: number | null
    is_group: boolean
    confidence: number
}

const currentYear = new Date().getFullYear()

const wordToNumber: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10
}

/**
 * Parse a date string into a Date object (UTC midnight).
 * Handles:
 *   - "July 15th"          → current year
 *   - "15 July 2025"       → 2025
 *   - "2025-07-15"         → 2025
 *   - "from July 15 to 17" → July 15 and 17 of current year
 */
function parseDate(dateStr: string): Date | null {
    // Remove ordinal suffixes
    let cleaned = dateStr.replace(/(\d+)(st|nd|rd|th)/, '$1')
    let d = new Date(cleaned)

    // If parsing succeeded and the year is 2001 (JS default) and the original string contains no 4-digit year,
    // replace with current year.
    if (!isNaN(d.getTime())) {
        const hasExplicitYear = /\d{4}/.test(dateStr)
        if (d.getFullYear() === 2001 && !hasExplicitYear) {
            d = new Date(currentYear, d.getMonth(), d.getDate())
        }
        // Return UTC midnight to avoid timezone shifts
        return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    }

    // Try "Month Day" with current year appended
    const withYear = `${cleaned} ${currentYear}`
    d = new Date(withYear)
    if (!isNaN(d.getTime())) {
        return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    }

    // Try "Day Month YYYY" (e.g., "15 July 2025")
    const parts = cleaned.split(/\s+/)
    if (parts.length === 3) {
        let [a, b, c] = parts
        if (a.match(/^\d+$/)) {
            d = new Date(`${b} ${a} ${c}`)
            if (!isNaN(d.getTime())) {
                return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
            }
        }
    }
    return null
}

function extractName(sender: string, body: string, subject: string): string | null {
    const fullText = `${subject}\n${body}`
    const fromMatch = sender.match(/[A-Za-z\s]+(?=\s*<)/)
    if (fromMatch) return fromMatch[0].trim()
    const nameLine = fullText.match(/(?:Name|Guest|Customer|Contact)[\s:]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i)
    if (nameLine) return nameLine[1].trim()
    const dearMatch = fullText.match(/Dear\s+([A-Za-z\s]+),/i)
    if (dearMatch) return dearMatch[1].trim()
    const firstLine = body.split('\n')[0].trim()
    if (firstLine && firstLine.length < 50) return firstLine
    return null
}

function extractRoomCount(text: string): number | null {
    const digitMatch = text.match(/(\d+)\s+rooms?/i)
    if (digitMatch) return parseInt(digitMatch[1])
    const wordMatch = text.match(/(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+rooms?/i)
    if (wordMatch) {
        const word = wordMatch[0].split(/\s/)[0].toLowerCase()
        return wordToNumber[word] || null
    }
    return null
}

function extractDates(text: string): { arrival: Date | null; departure: Date | null } {
    let arrival: Date | null = null
    let departure: Date | null = null

    // Pattern: "from July 15th to July 17th"
    const rangeMatch = text.match(/from\s+([A-Za-z]+\s+\d+(?:st|nd|rd|th)?)\s+to\s+([A-Za-z]+\s+\d+(?:st|nd|rd|th)?)/i)
    if (rangeMatch) {
        arrival = parseDate(rangeMatch[1])
        departure = parseDate(rangeMatch[2])
        if (arrival && departure) return { arrival, departure }
    }

    // Pattern: "arrival July 15th" / "check-in July 15"
    const arrivalPattern = /(?:arrival|check-?in|from)\s+([A-Za-z]+\s+\d+(?:st|nd|rd|th)?(?:\s*,?\s*\d{4})?)/i
    const departurePattern = /(?:departure|check-?out|to)\s+([A-Za-z]+\s+\d+(?:st|nd|rd|th)?(?:\s*,?\s*\d{4})?)/i

    const arrivalMatch = text.match(arrivalPattern)
    if (arrivalMatch) arrival = parseDate(arrivalMatch[1])
    const departureMatch = text.match(departurePattern)
    if (departureMatch) departure = parseDate(departureMatch[1])

    return { arrival, departure }
}

function isGroupBooking(text: string): boolean {
    return /(?:group|party|multiple rooms|block booking)/i.test(text)
}

export function extractFromEmail(sender: string, subject: string, body: string): ExtractedData {
    const fullText = `${subject}\n${body}`
    let confidence = 0

    const guest_name = extractName(sender, body, subject)
    if (guest_name) confidence += 0.2

    const { arrival, departure } = extractDates(fullText)
    if (arrival) confidence += 0.3
    if (departure) confidence += 0.3

    let number_of_rooms = extractRoomCount(fullText)
    if (number_of_rooms) confidence += 0.2
    else number_of_rooms = 1

    const is_group = isGroupBooking(fullText)
    if (is_group) confidence += 0.1

    return {
        guest_name: guest_name || null,
        arrival_date: arrival || null,
        departure_date: departure || null,
        number_of_rooms,
        is_group,
        confidence: Math.min(confidence, 1)
    }
}

export async function storeEmail(sender: string, subject: string, body: string) {
    const result = await db.execute(sql`
        INSERT INTO emails (sender, subject, body, status, created_at)
        VALUES (${sender}, ${subject}, ${body}, 'pending', NOW())
        RETURNING id
    `)
    const emailId = result.rows[0].id

    const extracted = extractFromEmail(sender, subject, body)
    await db.execute(sql`
        UPDATE emails
        SET parsed_data = ${JSON.stringify(extracted)},
            confidence_score = ${extracted.confidence}
        WHERE id = ${emailId}
    `)

    return { id: emailId, extracted }
}

export async function getEmails(status?: string) {
    let query = sql`SELECT * FROM emails ORDER BY created_at DESC`
    if (status) {
        query = sql`SELECT * FROM emails WHERE status = ${status} ORDER BY created_at DESC`
    }
    const result = await db.execute(query)
    return result.rows
}

export async function updateEmailParsedData(emailId: string, parsedData: any) {
    await db.execute(sql`
        UPDATE emails
        SET parsed_data = ${JSON.stringify(parsedData)},
            confidence_score = ${parsedData.confidence || 1}
        WHERE id = ${emailId}
    `)
}

export async function markEmailProcessed(emailId: string, createReservation = false, reservationData?: any) {
    if (createReservation && reservationData) {
        const { createReservation: createReservationFn } = await import('../reservations/reservation.service')
        const reservation = await createReservationFn({
            guest_name: reservationData.guest_name,
            guest_email: reservationData.guest_email,
            guest_phone: reservationData.guest_phone,
            arrival_date: new Date(reservationData.arrival_date),
            departure_date: new Date(reservationData.departure_date),
            room_type: reservationData.room_type,
            number_of_guests: reservationData.number_of_guests || 1,
            number_of_rooms: reservationData.number_of_rooms || 1,
            special_requests: reservationData.special_requests,
            source: 'email',
            status: 'pending_review',
        })
        await db.execute(sql`
            UPDATE emails SET status = 'processed', reservation_id = ${reservation.id} WHERE id = ${emailId}
        `)
        return reservation
    } else {
        await db.execute(sql`
            UPDATE emails SET status = 'processed' WHERE id = ${emailId}
        `)
        return null
    }
}