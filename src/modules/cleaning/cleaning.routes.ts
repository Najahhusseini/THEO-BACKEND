import { Hono } from 'hono'
import { db } from '../../db'
import { sql } from 'drizzle-orm'
import { 
    getRoomsWithCleaning,
    getHousekeepingStaff,
    upsertCleaningRequest,
    assignCleaning,
    updateRoomCleaningStatus,
    completeCleaning,
    ensureCheckoutRequests,
    ensureCleaningRequestsForDirtyRooms,
    updateDoNotDisturb,
    getDailyStats,
    updateCleaningRequestStatus,
    releaseRoom,
    reassignRoom,
    setRoomOutOfOrder,
    removeRoomOutOfOrder,
    getOutOfOrderRooms
} from './cleaning.service'


const cleaning = new Hono()

// Get all rooms with cleaning info (for Head of Housekeeping)
cleaning.get('/rooms', async (c) => {
    try {
        const user = c.get('user')
        const rooms = await getRoomsWithCleaning(user.tenantId)
        return c.json(rooms)
    } catch (err) {
        console.error(err)
        return c.json({ error: 'Failed to fetch rooms' }, 500)
    }
})

// Get daily stats for head of housekeeping dashboard
cleaning.get('/daily-stats', async (c) => {
    try {
        const user = c.get('user')
        const stats = await getDailyStats(user.tenantId)
        return c.json(stats)
    } catch (err) {
        console.error(err)
        return c.json({ error: 'Failed to fetch daily stats' }, 500)
    }
})

// Get housekeeping staff (for assignment dropdown)
cleaning.get('/staff/housekeeping', async (c) => {
    try {
        const user = c.get('user')
        const staff = await getHousekeepingStaff(user.tenantId)
        return c.json(staff)
    } catch (err) {
        return c.json({ error: 'Failed to fetch staff' }, 500)
    }
})

// Create or update a cleaning request (stay-over or checkout)
cleaning.post('/request', async (c) => {
    try {
        const user = c.get('user')
        const { roomId, notes, type } = await c.req.json()
        if (!roomId) return c.json({ error: 'roomId required' }, 400)
        const request = await upsertCleaningRequest(roomId, user.staffId, type || 'stay_over', notes)
        return c.json(request)
    } catch (err) {
        console.error(err)
        return c.json({ error: 'Failed to create request' }, 500)
    }
})

// Assign cleaning to a staff member (UPDATED to use assignCleaning which updates rooms.assigned_cleaner_id)
cleaning.post('/assign', async (c) => {
    try {
        const { requestId, assignedTo } = await c.req.json()
        if (!requestId || !assignedTo) return c.json({ error: 'Missing fields' }, 400)
        const result = await assignCleaning(requestId, assignedTo)
        return c.json(result)
    } catch (err: any) {
        return c.json({ error: err.message }, 500)
    }
})

// Update room cleaning status (dirty/cleaning/ready/inspected)
cleaning.patch('/rooms/:roomId/status', async (c) => {
    try {
        const user = c.get('user')
        const { roomId } = c.req.param()
        const { cleaningStatus } = await c.req.json()
        const updated = await updateRoomCleaningStatus(roomId, cleaningStatus, user.staffId)
        return c.json(updated)
    } catch (err: any) {
        return c.json({ error: err.message }, 500)
    }
})

// Complete a cleaning request (legacy, keep for compatibility)
cleaning.post('/complete', async (c) => {
    try {
        const user = c.get('user')
        const { requestId } = await c.req.json()
        await completeCleaning(requestId, user.staffId)
        return c.json({ success: true })
    } catch (err: any) {
        return c.json({ error: err.message }, 500)
    }
})

// Auto-create checkout cleaning requests for today's departures
cleaning.post('/ensure-checkouts', async (c) => {
    try {
        const user = c.get('user')
        const result = await ensureCheckoutRequests(user.tenantId)
        return c.json(result)
    } catch (error) {
        console.error('Error ensuring checkout requests:', error)
        return c.json({ error: 'Failed to ensure checkout requests' }, 500)
    }
})

// Auto-create cleaning requests for all dirty rooms
cleaning.post('/ensure-dirty-requests', async (c) => {
    try {
        const user = c.get('user')
        const result = await ensureCleaningRequestsForDirtyRooms(user.tenantId)
        console.log(`✅ Created ${result.created} cleaning requests for dirty rooms`)
        return c.json(result)
    } catch (error) {
        console.error('Error ensuring dirty room requests:', error)
        return c.json({ error: 'Failed to ensure cleaning requests for dirty rooms' }, 500)
    }
})

// ============ STAFF ENDPOINTS ============

// Get my assigned cleaning tasks (for cleaning staff)
cleaning.get('/my-tasks', async (c) => {
    try {
        const user = c.get('user')
        const result = await db.execute(sql`
            SELECT 
                cr.id as request_id,
                cr.room_id,
                cr.request_type,
                cr.status as request_status,
                cr.priority,
                cr.notes,
                cr.requested_at,
                cr.assigned_at,
                r.room_number,
                r.floor,
                r.room_type,
                r.cleaning_status,
                r.do_not_disturb,
                r.assigned_cleaner_id,
                COALESCE(b.guest_name, 'Guest') as guest_name,
                assigned.name as assigned_to_name
            FROM cleaning_requests cr
            JOIN rooms r ON cr.room_id = r.id
            LEFT JOIN bookings b ON r.id = b.room_id 
                AND b.check_in_date <= CURRENT_DATE 
                AND b.check_out_date >= CURRENT_DATE
            LEFT JOIN staff assigned ON cr.assigned_to = assigned.id
            WHERE cr.assigned_to = ${user.staffId}
              AND cr.status IN ('pending', 'assigned', 'in_progress')
            ORDER BY 
                CASE cr.priority 
                    WHEN 'urgent' THEN 1 
                    WHEN 'high' THEN 2 
                    ELSE 3 
                END,
                cr.assigned_at NULLS LAST,
                cr.requested_at
        `)
        return c.json(result.rows)
    } catch (error) {
        console.error('Error in GET /my-tasks:', error)
        return c.json({ error: 'Failed to fetch your tasks' }, 500)
    }
})

// Get rooms directly assigned to me (based on rooms.assigned_cleaner_id)
cleaning.get('/my-rooms', async (c) => {
    try {
        const user = c.get('user')
        const result = await db.execute(sql`
            SELECT 
                r.id,
                r.room_number,
                r.floor,
                r.room_type,
                r.cleaning_status,
                r.last_cleaning_update,
                r.do_not_disturb,
                r.assigned_cleaner_id,
                COALESCE(b.guest_name, 'Vacant') as guest_name,
                cr.id as cleaning_request_id,
                cr.status as request_status,
                cr.started_at
            FROM rooms r
            LEFT JOIN bookings b ON r.id = b.room_id 
                AND b.check_in_date <= CURRENT_DATE 
                AND b.check_out_date >= CURRENT_DATE
            LEFT JOIN cleaning_requests cr ON r.id = cr.room_id AND cr.status IN ('pending', 'assigned', 'in_progress')
            WHERE r.tenant_id = ${user.tenantId}
              AND r.assigned_cleaner_id = ${user.staffId}
            ORDER BY r.floor, r.room_number
        `)
        return c.json({ assignedRooms: result.rows, totalAssigned: result.rows.length })
    } catch (error) {
        console.error('Error in GET /my-rooms:', error)
        return c.json({ error: 'Failed to fetch your assigned rooms' }, 500)
    }
})

// Release a room (cleaning staff voluntarily gives up assigned room)
cleaning.post('/rooms/:roomId/release', async (c) => {
    try {
        const user = c.get('user')
        const { roomId } = c.req.param()
        const result = await releaseRoom(roomId, user.staffId)
        return c.json(result)
    } catch (err: any) {
        return c.json({ error: err.message }, 500)
    }
})

// Reassign a room (head of housekeeping only)
cleaning.patch('/rooms/:roomId/reassign', async (c) => {
    try {
        const user = c.get('user')
        const { roomId } = c.req.param()
        const { newStaffId } = await c.req.json()
        
        // Only head_housekeeping can reassign
        if (user.role !== 'head_housekeeping') {
            return c.json({ error: 'Unauthorized' }, 403)
        }
        
        const result = await reassignRoom(roomId, newStaffId, user.staffId)
        return c.json(result)
    } catch (err: any) {
        return c.json({ error: err.message }, 500)
    }
})

// Get all available cleaning staff (for assignment dropdown)
cleaning.get('/staff/available', async (c) => {
    try {
        const user = c.get('user')
        const result = await db.execute(sql`
            SELECT id, name, email
            FROM staff
            WHERE tenant_id = ${user.tenantId}
              AND role = 'housekeeping'
              AND active = true
            ORDER BY name
        `)
        return c.json(result.rows)
    } catch (error) {
        console.error('Error fetching available staff:', error)
        return c.json({ error: 'Failed to fetch staff' }, 500)
    }
})

// ============ UPDATE CLEANING TASK STATUS ============
cleaning.patch('/tasks/:requestId/status', async (c) => {
    try {
        const user = c.get('user')
        const { requestId } = c.req.param()
        const { status } = await c.req.json()
        
        const allowed = ['accepted', 'in_progress', 'completed']
        if (!allowed.includes(status)) {
            return c.json({ error: 'Invalid status' }, 400)
        }
        
        const result = await updateCleaningRequestStatus(requestId, status, user.staffId)
        return c.json(result)
    } catch (error: any) {
        console.error('Error in PATCH /tasks/:requestId/status:', error)
        return c.json({ error: error.message }, 500)
    }
})

// Get messages for a specific cleaning task
cleaning.get('/tasks/:requestId/messages', async (c) => {
    try {
        const { requestId } = c.req.param()
        
        const result = await db.execute(sql`
            SELECT 
                cm.id,
                cm.message,
                cm.created_at,
                s.name as staff_name,
                s.role
            FROM cleaning_messages cm
            JOIN staff s ON cm.staff_id = s.id
            WHERE cm.cleaning_request_id = ${requestId}
            ORDER BY cm.created_at ASC
        `)
        return c.json(result.rows)
    } catch (error) {
        console.error('Error in GET /tasks/:requestId/messages:', error)
        return c.json({ error: 'Failed to fetch messages' }, 500)
    }
})

// Send a message for a cleaning task
cleaning.post('/tasks/:requestId/messages', async (c) => {
    try {
        const user = c.get('user')
        const { requestId } = c.req.param()
        const { message } = await c.req.json()
        
        if (!message) return c.json({ error: 'Message required' }, 400)
        
        await db.execute(sql`
            INSERT INTO cleaning_messages (cleaning_request_id, staff_id, message)
            VALUES (${requestId}, ${user.staffId}, ${message})
        `)
        return c.json({ success: true })
    } catch (error) {
        console.error('Error in POST /tasks/:requestId/messages:', error)
        return c.json({ error: 'Failed to send message' }, 500)
    }
})

// Request supplies for a cleaning task
cleaning.post('/tasks/:requestId/supplies', async (c) => {
    try {
        const user = c.get('user')
        const { requestId } = c.req.param()
        const { itemName, quantity, notes } = await c.req.json()
        
        if (!itemName) return c.json({ error: 'Item name required' }, 400)
        
        await db.execute(sql`
            INSERT INTO supply_requests (cleaning_request_id, staff_id, item_name, quantity, notes, status)
            VALUES (${requestId}, ${user.staffId}, ${itemName}, ${quantity}, ${notes || null}, 'pending')
        `)
        
        return c.json({ success: true })
    } catch (error) {
        console.error('Error in POST /tasks/:requestId/supplies:', error)
        return c.json({ error: 'Failed to request supplies' }, 500)
    }
})

// Update Do Not Disturb status (cleaning staff only)
cleaning.patch('/rooms/:roomId/dnd', async (c) => {
    try {
        const user = c.get('user')
        const { roomId } = c.req.param()
        const { doNotDisturb } = await c.req.json()
        
        // Only housekeeping or head_housekeeping can update
        if (!['housekeeping', 'head_housekeeping'].includes(user.role)) {
            return c.json({ error: 'Unauthorized' }, 403)
        }
        
        await updateDoNotDisturb(roomId, doNotDisturb, user.name)
        
        return c.json({ success: true, doNotDisturb })
    } catch (error) {
        console.error('Error updating DND:', error)
        return c.json({ error: 'Failed to update DND status' }, 500)
    }
})

// ============ SUPPLY REQUEST MANAGEMENT ============

// Get all supply requests (for Head of Housekeeping)
cleaning.get('/supply-requests', async (c) => {
    try {
        const user = c.get('user')
        const { status } = c.req.query()
        
        let query = sql`
            SELECT 
                sr.id,
                sr.item_name,
                sr.quantity,
                sr.notes,
                sr.status,
                sr.created_at,
                sr.approved_at,
                s.name as staff_name,
                cr.room_id,
                r.room_number,
                approved.name as approved_by_name
            FROM supply_requests sr
            JOIN staff s ON sr.staff_id = s.id
            LEFT JOIN cleaning_requests cr ON sr.cleaning_request_id = cr.id
            LEFT JOIN rooms r ON cr.room_id = r.id
            LEFT JOIN staff approved ON sr.approved_by = approved.id
            WHERE s.tenant_id = ${user.tenantId}
        `
        
        if (status && status !== 'all') {
            query = sql`${query} AND sr.status = ${status}`
        }
        
        query = sql`${query} ORDER BY sr.created_at DESC`
        
        const result = await db.execute(query)
        return c.json(result.rows)
    } catch (error) {
        console.error('Error fetching supply requests:', error)
        return c.json({ error: 'Failed to fetch supply requests' }, 500)
    }
})

// Approve or deny supply request (with inventory validation)
cleaning.patch('/supply-requests/:requestId', async (c) => {
    try {
        const user = c.get('user')
        const { requestId } = c.req.param()
        const { status, notes } = await c.req.json()
        
        if (!['approved', 'denied'].includes(status)) {
            return c.json({ error: 'Invalid status' }, 400)
        }
        
        // Get the request details
        const request = await db.execute(sql`
            SELECT item_name, quantity FROM supply_requests WHERE id = ${requestId}
        `)
        
        if (request.rows.length === 0) {
            return c.json({ error: 'Request not found' }, 404)
        }
        
        // If approved, check inventory and deduct
        if (status === 'approved') {
            // Check current stock
            const stock = await db.execute(sql`
                SELECT quantity FROM inventory WHERE item_name = ${request.rows[0].item_name}
            `)
            
            if (stock.rows.length === 0) {
                return c.json({ error: `Item "${request.rows[0].item_name}" not found in inventory. Please add it first.` }, 400)
            }
            
            const currentQuantity = stock.rows[0].quantity
            const requestedQuantity = request.rows[0].quantity
            
            if (currentQuantity < requestedQuantity) {
                return c.json({ 
                    error: `Insufficient stock. Only ${currentQuantity} ${request.rows[0].item_name} available, but ${requestedQuantity} requested.` 
                }, 400)
            }
            
            // Deduct from inventory
            await db.execute(sql`
                UPDATE inventory 
                SET quantity = quantity - ${requestedQuantity},
                    last_updated = NOW()
                WHERE item_name = ${request.rows[0].item_name}
            `)
        }
        
        // Update request status
        await db.execute(sql`
            UPDATE supply_requests 
            SET status = ${status},
                approved_at = NOW(),
                approved_by = ${user.staffId},
                notes = COALESCE(${notes}, notes)
            WHERE id = ${requestId}
        `)
        
        return c.json({ success: true, status })
    } catch (error) {
        console.error('Error updating supply request:', error)
        return c.json({ error: 'Failed to update supply request' }, 500)
    }
})

// Get inventory levels
cleaning.get('/inventory', async (c) => {
    try {
        const user = c.get('user')
        const result = await db.execute(sql`
            SELECT * FROM inventory ORDER BY item_name
        `)
        return c.json(result.rows)
    } catch (error) {
        console.error('Error fetching inventory:', error)
        return c.json({ error: 'Failed to fetch inventory' }, 500)
    }
})

// Update inventory (add stock)
cleaning.post('/inventory/:itemId', async (c) => {
    try {
        const { itemId } = c.req.param()
        const { quantity, notes } = await c.req.json()
        
        await db.execute(sql`
            UPDATE inventory 
            SET quantity = quantity + ${quantity},
                last_updated = NOW()
            WHERE id = ${itemId}
        `)
        
        return c.json({ success: true })
    } catch (error) {
        console.error('Error updating inventory:', error)
        return c.json({ error: 'Failed to update inventory' }, 500)
    }
})

// Staff supply request (without cleaning task)
cleaning.post('/staff-supply-request', async (c) => {
    try {
        const user = c.get('user')
        const { itemName, quantity, notes } = await c.req.json()
        
        if (!itemName) return c.json({ error: 'Item name required' }, 400)
        if (!quantity || quantity <= 0) return c.json({ error: 'Valid quantity required' }, 400)
        
        await db.execute(sql`
            INSERT INTO supply_requests (staff_id, item_name, quantity, notes, status)
            VALUES (${user.staffId}, ${itemName}, ${quantity}, ${notes || null}, 'pending')
        `)
        
        return c.json({ success: true, message: 'Supply request submitted' })
    } catch (error) {
        console.error('Error creating staff supply request:', error)
        return c.json({ error: 'Failed to create supply request' }, 500)
    }
})

// Head of housekeeping marks room as awaiting new guest (final clean state)
cleaning.patch('/rooms/:roomId/awaiting', async (c) => {
    try {
        const user = c.get('user');
        const { roomId } = c.req.param();
        
        // Only head_housekeeping can perform this action
        if (user.role !== 'head_housekeeping') {
            return c.json({ error: 'Unauthorized' }, 403);
        }
        
        await db.execute(sql`
            UPDATE rooms 
            SET cleaning_status = 'awaiting', 
                last_cleaning_update = NOW(),
                last_updated_by = ${user.staffId}
            WHERE id = ${roomId}
        `);
        
        return c.json({ success: true });
    } catch (error) {
        console.error(error);
        return c.json({ error: 'Failed to update status' }, 500)
    }
});

// ============ PERFORMANCE ENDPOINT ============
// Get completed cleaning tasks with duration (for head of housekeeping)
cleaning.get('/completed-tasks', async (c) => {
    try {
        const user = c.get('user');
        const result = await db.execute(sql`
            SELECT 
                cr.id,
                r.room_number,
                s.name as staff_name,
                cr.started_at,
                cr.completed_at,
                cr.duration_seconds,
                cr.request_type
            FROM cleaning_requests cr
            JOIN rooms r ON cr.room_id = r.id
            JOIN staff s ON cr.assigned_to = s.id
            WHERE cr.status = 'completed'
              AND r.tenant_id = ${user.tenantId}
              AND cr.duration_seconds IS NOT NULL
            ORDER BY cr.completed_at DESC
            LIMIT 500
        `);
        return c.json(result.rows);
    } catch (error) {
        console.error(error);
        return c.json({ error: 'Failed to fetch completed tasks' }, 500);
    }
});


// ============ OUT OF ORDER ROUTES ============

// Mark a room as out of order (Head of Housekeeping only)
cleaning.post('/rooms/:roomId/out-of-order', async (c) => {
  try {
    const user = c.get('user')
    const { roomId } = c.req.param()
    const { reason } = await c.req.json()
    
    if (!reason || reason.trim() === '') {
      return c.json({ error: 'Reason is required for out of order' }, 400)
    }
    
    // Only head_housekeeping, admin, or manager can do this
    if (!['head_housekeeping', 'admin', 'manager'].includes(user.role)) {
      return c.json({ error: 'Unauthorized - Only Head of Housekeeping can mark rooms out of order' }, 403)
    }
    
    const result = await setRoomOutOfOrder(roomId, reason, user.staffId)
    return c.json(result)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// Remove out of order status (Head of Housekeeping only)
cleaning.delete('/rooms/:roomId/out-of-order', async (c) => {
  try {
    const user = c.get('user')
    const { roomId } = c.req.param()
    
    // Only head_housekeeping, admin, or manager can do this
    if (!['head_housekeeping', 'admin', 'manager'].includes(user.role)) {
      return c.json({ error: 'Unauthorized - Only Head of Housekeeping can remove out of order status' }, 403)
    }
    
    const result = await removeRoomOutOfOrder(roomId, user.staffId)
    return c.json(result)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// Get all out of order rooms
cleaning.get('/out-of-order', async (c) => {
  try {
    const user = c.get('user')
    const rooms = await getOutOfOrderRooms(user.tenantId)
    return c.json(rooms)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

export default cleaning