import { db } from '../../db'
import { sql } from 'drizzle-orm'

interface ExtractedData {
    guest_name: string | null
    arrival_date: Date | null
    departure_date: Date | null
    number_of_rooms: number | null
    number_of_guests: number
    is_group: boolean
    confidence: number
}

const currentYear = new Date().getFullYear()
const wordToNumber: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10
}

function extractName(sender: string, body: string, subject: string): string | null {
    const fullText = `${subject}\n${body}`;
    const fromMatch = sender.match(/^"?([A-Za-z\s]+)"?\s*</);
    if (fromMatch && fromMatch[1].trim().length > 2) return fromMatch[1].trim();
    const explicit = fullText.match(/(?:Name|Guest|Customer|Contact)[\s:]+([A-Za-z]+(?:\s+[A-Za-z]+){1,3})/i);
    if (explicit) return explicit[1].trim();
    const dear = fullText.match(/Dear\s+([A-Za-z]+(?:\s+[A-Za-z]+)?),?/i);
    if (dear) return dear[1].trim();
    const firstLine = body.split('\n')[0].trim();
    if (firstLine && firstLine.length < 60 && !/\d/.test(firstLine) && !/@/.test(firstLine) && !/^(hi|hello|hey|dear)/i.test(firstLine)) {
        return firstLine;
    }
    return null;
}

function parseDate(str: string): Date | null {
    let cleaned = str.replace(/(\d+)(st|nd|rd|th)/i, '$1');
    let d = new Date(cleaned);
    if (!isNaN(d.getTime()) && /\d{4}/.test(cleaned)) {
        return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    }
    const parts = cleaned.split(/[\s,\/.-]+/);
    if (parts.length === 3) {
        d = new Date(parts.join(' '));
        if (!isNaN(d.getTime())) {
            return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        }
    }
    if (parts.length === 2) {
        const withYear = cleaned + ' ' + currentYear;
        d = new Date(withYear);
        if (!isNaN(d.getTime())) {
            return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        }
    }
    return null;
}

function extractDates(text: string): { arrival: Date | null; departure: Date | null } {
    const cleanText = text.split('-- ')[0];
    let arrival: Date | null = null;
    let departure: Date | null = null;

    const range = cleanText.match(/(?:from|arriving|check[-\s]?in)\s+([A-Za-z0-9\s\/\.\-]+?)\s+(?:to|until|through|departing|check[-\s]?out)\s+([A-Za-z0-9\s\/\.\-]+)/i)
        || cleanText.match(/(\d{1,2}\s*[\/\-\.]\s*\d{1,2}\s*[\/\-\.]\s*\d{2,4})\s*[-–]\s*(\d{1,2}\s*[\/\-\.]\s*\d{1,2}\s*[\/\-\.]\s*\d{2,4})/);
    if (range) {
        arrival = parseDate(range[1]);
        departure = parseDate(range[2]);
        if (arrival && departure) return { arrival, departure };
    }

    const arrMatch = cleanText.match(/(?:arrival|check[-\s]?in|starting)\s+([A-Za-z0-9\s\/\.\-]+)/i);
    if (arrMatch) arrival = parseDate(arrMatch[1]);
    const depMatch = cleanText.match(/(?:departure|check[-\s]?out|ending)\s+([A-Za-z0-9\s\/\.\-]+)/i);
    if (depMatch) departure = parseDate(depMatch[1]);

    return { arrival, departure };
}

function extractRoomCount(text: string): number | null {
    const digit = text.match(/(\d+)\s+rooms?/i);
    if (digit) return parseInt(digit[1]);
    const wordMatch = text.match(/(one|two|three|four|five|six|seven|eight|nine|ten)\s+rooms?/i);
    if (wordMatch) return wordToNumber[wordMatch[1].toLowerCase()] || null;
    return null;
}

function extractGuestCount(text: string): number | null {
    const match = text.match(/(\d+)\s*(?:adults?|guests?|people|persons?)/i);
    return match ? parseInt(match[1]) : null;
}

function isGroupBooking(text: string): boolean {
    return /(?:group|party|multiple rooms|block booking)/i.test(text);
}

export function extractFromEmail(sender: string, subject: string, body: string): ExtractedData {
    const fullText = `${subject}\n${body}`;
    let confidence = 0;

    const guest_name = extractName(sender, body, subject);
    if (guest_name) confidence += 0.15;

    const { arrival, departure } = extractDates(fullText);
    if (arrival) confidence += 0.25;
    if (departure) confidence += 0.25;

    let number_of_rooms = extractRoomCount(fullText);
    if (number_of_rooms) confidence += 0.15;
    else number_of_rooms = 1;

    const number_of_guests = extractGuestCount(fullText);
    if (number_of_guests) confidence += 0.1;

    const is_group = isGroupBooking(fullText);
    if (is_group) confidence += 0.1;

    return {
        guest_name,
        arrival_date: arrival,
        departure_date: departure,
        number_of_rooms,
        number_of_guests: number_of_guests || 1,
        is_group,
        confidence: Math.min(confidence, 1)
    };
}

export async function storeEmail(sender: string, subject: string, body: string) {
    const result = await db.execute(sql`
        INSERT INTO emails (sender, subject, body, status, created_at)
        VALUES (${sender}, ${subject}, ${body}, 'pending', NOW())
        RETURNING id
    `);
    const emailId = result.rows[0].id;
    const extracted = extractFromEmail(sender, subject, body);
    await db.execute(sql`
        UPDATE emails
        SET parsed_data = ${JSON.stringify(extracted)},
            confidence_score = ${extracted.confidence}
        WHERE id = ${emailId}
    `);
    return { id: emailId, extracted };
}

export async function getEmails(status?: string) {
    let query = sql`SELECT * FROM emails ORDER BY created_at DESC`;
    if (status) {
        query = sql`SELECT * FROM emails WHERE status = ${status} ORDER BY created_at DESC`;
    }
    const result = await db.execute(query);
    return result.rows;
}

export async function updateEmailParsedData(emailId: string, parsedData: any) {
    await db.execute(sql`
        UPDATE emails
        SET parsed_data = ${JSON.stringify(parsedData)},
            confidence_score = ${parsedData.confidence || 1}
        WHERE id = ${emailId}
    `);
}

export async function markEmailProcessed(emailId: string, createReservation = false, reservationData?: any) {
    if (createReservation && reservationData) {
        const { createReservation: createReservationFn } = await import('../reservations/reservation.service');
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
        });
        await db.execute(sql`
            UPDATE emails SET status = 'processed', reservation_id = ${reservation.id} WHERE id = ${emailId}
        `);
        return reservation;
    } else {
        await db.execute(sql`
            UPDATE emails SET status = 'processed' WHERE id = ${emailId}
        `);
        return null;
    }
}