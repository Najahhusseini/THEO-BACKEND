import { db } from '../../db'
import { sql } from 'drizzle-orm'
import { FinancialService } from '../financial/financial.service'

// Create a folio for a stay (called when a reservation is confirmed)
export async function createFolio(stayId: string, reservationId: string, guestName: string) {
  const result = await db.execute(sql`
    INSERT INTO folios (stay_id, reservation_id, guest_name, status)
    VALUES (${stayId}, ${reservationId}, ${guestName}, 'open')
    RETURNING *
  `)
  return result.rows[0]
}

// Close the folio (when guest checks out)
export async function closeFolio(stayId: string, tenantId: string) {
  // First close the folio
  await db.execute(sql`
    UPDATE folios SET status = 'closed', closed_at = NOW()
    WHERE stay_id = ${stayId} AND status = 'open'
  `)

  // Record financial event via the outbox
  const financialService = new FinancialService()
  const payload = await buildFinancialEventPayload(stayId)
  await financialService.recordEvent(tenantId, 'guest.checked_out', payload)
}

// Get a folio by stay ID
export async function getFolioByStayId(stayId: string) {
  const result = await db.execute(sql`
    SELECT * FROM folios WHERE stay_id = ${stayId} LIMIT 1
  `)
  return result.rows[0]
}

// Get all items for a folio
export async function getFolioItems(folioId: string) {
  const result = await db.execute(sql`
    SELECT * FROM folio_items WHERE folio_id = ${folioId} ORDER BY created_at
  `)
  return result.rows
}

// Add a charge/payment/adjustment to a folio
export async function addFolioItem(
  folioId: string,
  description: string,
  amount: number,
  chargeType: string = 'room_charge',
  quantity: number = 1,
  unitPrice: number | null = null,
  taxCode: string | null = null
) {
  await db.execute(sql`
    INSERT INTO folio_items (folio_id, description, amount, charge_type, quantity, unit_price, tax_code)
    VALUES (${folioId}, ${description}, ${amount}, ${chargeType}, ${quantity}, ${unitPrice || amount}, ${taxCode})
  `)
}

// Build the full financial event packet for a closed folio
export async function buildFinancialEventPayload(stayId: string) {
  const folio = await getFolioByStayId(stayId)
  if (!folio) throw new Error('Folio not found')

  const items = await getFolioItems(folio.id)
  const totalAmount = items.reduce((sum: number, item: any) => sum + parseFloat(item.amount), 0)

  const stayResult = await db.execute(sql`
    SELECT s.*, r.room_number, r.tenant_id
    FROM stays s
    JOIN rooms r ON s.room_number = r.room_number
    WHERE s.id = ${stayId}
  `)
  const stay = stayResult.rows[0]

  const tenantResult = await db.execute(sql`
    SELECT id, name, subdomain, address, phone FROM tenants WHERE id = ${stay.tenant_id}
  `)
  const property = tenantResult.rows[0]

  return {
    event_id: crypto.randomUUID(),
    event_type: 'folio.closed',
    timestamp: new Date().toISOString(),
    property: {
      id: property.id,
      name: property.name,
      subdomain: property.subdomain,
      address: property.address,
      phone: property.phone,
    },
    guest: {
      name: stay.guest_name,
    },
    stay: {
      reservation_id: stay.reservation_id,
      room_number: stay.room_number,
      arrival: stay.arrival_date,
      departure: stay.departure_date,
      status: stay.status,
    },
    folio: {
      folio_id: folio.id,
      currency: 'USD',
      items: items.map((item: any) => ({
        description: item.description,
        quantity: item.quantity || 1,
        unit_price: parseFloat(item.unit_price) || parseFloat(item.amount),
        amount: parseFloat(item.amount),
        charge_type: item.charge_type,
        tax_code: item.tax_code,
      })),
      total_amount: totalAmount,
    },
  }
}

// Backward compatibility (if any other part of code calls this)
export async function createFinancialEvent(tenantId: string, stayId: string) {
  const financialService = new FinancialService()
  const payload = await buildFinancialEventPayload(stayId)
  return financialService.recordEvent(tenantId, 'guest.checked_out', payload)
}