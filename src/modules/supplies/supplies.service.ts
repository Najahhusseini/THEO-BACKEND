import { db } from '../../db'
import { sql } from 'drizzle-orm'
import { sendNotificationToTenant } from '../notifications/notification.service'

// Get all supply items for a tenant (with optional category filter)
export async function getSupplyItems(tenantId: string, category?: string) {
    let query = sql`
        SELECT si.*, sc.name as category_name
        FROM supply_items si
        JOIN supply_categories sc ON si.category_id = sc.id
        WHERE si.tenant_id = ${tenantId}
    `
    if (category && category !== 'all') {
        query = sql`${query} AND sc.name = ${category}`
    }
    query = sql`${query} ORDER BY sc.name, si.name`
    const result = await db.execute(query)
    return result.rows
}

// Get single supply item
export async function getSupplyItem(itemId: string) {
    const result = await db.execute(sql`
        SELECT si.*, sc.name as category_name
        FROM supply_items si
        JOIN supply_categories sc ON si.category_id = sc.id
        WHERE si.id = ${itemId}
    `)
    return result.rows[0]
}

// Create new supply item
export async function createSupplyItem(
    tenantId: string,
    categoryId: string,
    name: string,
    itemsPerBox: number,
    initialBoxes: number,
    minThresholdItems: number
) {
    const result = await db.execute(sql`
        INSERT INTO supply_items (tenant_id, category_id, name, items_per_box, current_boxes, min_threshold_items)
        VALUES (${tenantId}, ${categoryId}, ${name}, ${itemsPerBox}, ${initialBoxes}, ${minThresholdItems})
        RETURNING *
    `)
    return result.rows[0]
}

// Adjust stock (add or remove boxes)
export async function adjustStock(
    itemId: string,
    staffId: string,
    quantityBoxes: number,
    reason: string,
    referenceType?: string,
    referenceId?: string
) {
    // Get current item
    const item = await getSupplyItem(itemId)
    if (!item) throw new Error('Item not found')

    const newBoxes = item.current_boxes + quantityBoxes
    if (newBoxes < 0) throw new Error('Insufficient stock')

    // Update item
    const updatedItem = await db.execute(sql`
        UPDATE supply_items
        SET current_boxes = ${newBoxes}, updated_at = NOW()
        WHERE id = ${itemId}
        RETURNING *
    `)

    // Record transaction
    await db.execute(sql`
        INSERT INTO supply_transactions (item_id, staff_id, quantity_boxes, reason, reference_type, reference_id)
        VALUES (${itemId}, ${staffId}, ${quantityBoxes}, ${reason}, ${referenceType || null}, ${referenceId || null})
    `)

    // Calculate total items after adjustment
    const totalItems = newBoxes * item.items_per_box

    // Check low stock and send notification
    if (totalItems < item.min_threshold_items) {
        // Get tenant ID for notification
        const tenantResult = await db.execute(sql`
            SELECT tenant_id FROM supply_items WHERE id = ${itemId}
        `)
        const tenantId = tenantResult.rows[0]?.tenant_id
        if (tenantId) {
            await sendNotificationToTenant(
                tenantId,
                '⚠️ Low Stock Alert',
                `${item.name} is low (${totalItems} items left, threshold ${item.min_threshold_items}). Please reorder.`,
                '/supplies-icon.png',
                '/dashboard?tab=supplies'
            )
        }
    }

    return updatedItem.rows[0]
}

// Get transaction history for an item
export async function getTransactionHistory(itemId: string, limit: number = 50) {
    const result = await db.execute(sql`
        SELECT st.*, s.name as staff_name
        FROM supply_transactions st
        LEFT JOIN staff s ON st.staff_id = s.id
        WHERE st.item_id = ${itemId}
        ORDER BY st.created_at DESC
        LIMIT ${limit}
    `)
    return result.rows
}

// Get low stock items
export async function getLowStockItems(tenantId: string) {
    const result = await db.execute(sql`
        SELECT si.*, sc.name as category_name,
               (si.current_boxes * si.items_per_box) as total_items
        FROM supply_items si
        JOIN supply_categories sc ON si.category_id = sc.id
        WHERE si.tenant_id = ${tenantId}
          AND (si.current_boxes * si.items_per_box) < si.min_threshold_items
        ORDER BY (si.current_boxes * si.items_per_box) ASC
    `)
    return result.rows
}