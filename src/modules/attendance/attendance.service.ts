import { db } from '../../db'
import { sql } from 'drizzle-orm'
import { eventBus } from '../../events/eventBus'

// Clock in
export async function clockIn(staffId: string, location?: string, deviceInfo?: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  // Check if already clocked in today
  const existing = await db.execute(sql`
    SELECT id FROM attendance 
    WHERE staff_id = ${staffId} 
    AND clock_in >= ${today.toISOString()} 
    AND clock_out IS NULL
    LIMIT 1
  `)
  
  if (existing.rows.length > 0) {
    throw new Error('Already clocked in today')
  }
  
  const result = await db.execute(sql`
    INSERT INTO attendance (staff_id, clock_in, location, device_info) 
    VALUES (${staffId}, NOW(), ${location || null}, ${deviceInfo || null}) 
    RETURNING *
  `)
  
  // Emit event for auto‑assignment
  try {
    const staffResult = await db.execute(sql`
      SELECT id, tenant_id, role FROM staff WHERE id = ${staffId}
    `)
    const staff = staffResult.rows[0]
    if (staff) {
      eventBus.emit(staff.tenant_id, 'attendance.clock_in', {
        staffId,
        tenantId: staff.tenant_id,
        role: staff.role,
        timestamp: new Date().toISOString(),
      })
    }
  } catch (err) {
    console.error('Failed to emit clock_in event:', err)
  }
  
  return result.rows[0]
}

// Clock out
export async function clockOut(staffId: string) {
  const activeShift = await db.execute(sql`
    SELECT id, clock_in FROM attendance 
    WHERE staff_id = ${staffId} 
    AND clock_out IS NULL 
    ORDER BY clock_in DESC 
    LIMIT 1
  `)
  
  if (activeShift.rows.length === 0) {
    throw new Error('No active shift found')
  }
  
  const result = await db.execute(sql`
    UPDATE attendance 
    SET clock_out = NOW() 
    WHERE id = ${activeShift.rows[0].id} 
    RETURNING *
  `)
  
  return result.rows[0]
}

// Get current status (includes clockInTime for frontend)
export async function getCurrentStatus(staffId: string) {
  const activeShift = await db.execute(sql`
    SELECT id, clock_in FROM attendance 
    WHERE staff_id = ${staffId} 
    AND clock_out IS NULL 
    ORDER BY clock_in DESC 
    LIMIT 1
  `)
  
  const isClockedIn = activeShift.rows.length > 0
  const clockInTime = isClockedIn ? activeShift.rows[0].clock_in : null
  
  return {
    isClockedIn,
    clockInTime,
    shift: activeShift.rows[0] || null,
  }
}

// Get today's attendance for a specific staff member
export async function getTodayAttendance(staffId: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  const result = await db.execute(sql`
    SELECT 
      id,
      clock_in,
      clock_out,
      location,
      device_info,
      EXTRACT(EPOCH FROM (clock_out - clock_in)) / 60 as duration_minutes
    FROM attendance 
    WHERE staff_id = ${staffId} 
      AND clock_in >= ${today.toISOString()}
    ORDER BY clock_in DESC
  `)
  
  return result.rows.map(row => ({
    id: row.id,
    clock_in: row.clock_in,
    clock_out: row.clock_out,
    duration_minutes: row.duration_minutes ? Math.round(parseFloat(row.duration_minutes)) : null,
    location: row.location,
    device_info: row.device_info,
  }))
}

// Get today's attendance for all staff (manager only)
export async function getAllStaffTodayAttendance(tenantId: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  const result = await db.execute(sql`
    SELECT 
      s.id as staff_id,
      s.name as staff_name,
      s.role as staff_role,
      s.email as staff_email,
      a.id as attendance_id,
      a.clock_in,
      a.clock_out
    FROM staff s
    LEFT JOIN attendance a ON s.id = a.staff_id 
      AND a.clock_in >= ${today.toISOString()}
    WHERE s.tenant_id = ${tenantId} AND s.active = true
    ORDER BY s.name
  `)
  
  const grouped = new Map()
  for (const record of result.rows) {
    if (!grouped.has(record.staff_id)) {
      grouped.set(record.staff_id, {
        staffId: record.staff_id,
        name: record.staff_name,
        role: record.staff_role,
        email: record.staff_email,
        isClockedIn: false,
        clockIn: null,
        clockOut: null,
        hoursWorked: 0,
        overtimeHours: 0,
      })
    }
    
    if (record.clock_in) {
      const staffData = grouped.get(record.staff_id)
      staffData.isClockedIn = !record.clock_out
      staffData.clockIn = record.clock_in
      staffData.clockOut = record.clock_out
    }
  }
  
  return Array.from(grouped.values())
}

// Get weekly hours (Monday to Sunday)
export async function getWeeklyHours(staffId: string) {
  const result = await db.execute(sql`
    SELECT 
      DATE(clock_in) as day,
      EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600 as hours
    FROM attendance 
    WHERE staff_id = ${staffId} 
      AND clock_in >= DATE_TRUNC('week', CURRENT_DATE)
      AND clock_out IS NOT NULL
  `)
  
  const totalHours = result.rows.reduce((sum, row) => sum + (parseFloat(row.hours) || 0), 0)
  const daysWorked = result.rows.length
  const averageHours = daysWorked > 0 ? totalHours / daysWorked : 0
  
  return {
    total_hours: totalHours,
    days_worked: daysWorked,
    average_hours: averageHours,
    totalOvertime: 0,
    remainingHours: Math.max(0, 40 - totalHours),
  }
}

// Get shift history (last N days)
export async function getShiftHistory(staffId: string, days: number = 30) {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)
  
  const result = await db.execute(sql`
    SELECT 
      id,
      clock_in,
      clock_out,
      EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600 as hours_worked,
      0 as overtime_hours,
      location
    FROM attendance 
    WHERE staff_id = ${staffId} 
      AND clock_in >= ${startDate.toISOString()}
    ORDER BY clock_in DESC
  `)
  
  return result.rows.map(row => ({
    id: row.id,
    clockIn: row.clock_in,
    clockOut: row.clock_out,
    hoursWorked: parseFloat(row.hours_worked) || 0,
    overtimeHours: parseFloat(row.overtime_hours) || 0,
    shiftType: row.clock_in && new Date(row.clock_in).getHours() > 9 ? 'late' : 'regular',
    location: row.location || '',
  }))
}

// Time off functions
export async function requestTimeOff(staffId: string, startDate: Date, endDate: Date, reason: string) {
  const result = await db.execute(sql`
    INSERT INTO time_off_requests (staff_id, start_date, end_date, reason, status)
    VALUES (${staffId}, ${startDate.toISOString()}, ${endDate.toISOString()}, ${reason}, 'pending')
    RETURNING *
  `)
  return result.rows[0]
}

export async function getTimeOffRequests(tenantId: string, status?: string) {
  let query = sql`
    SELECT 
      tor.*,
      s.name as staff_name,
      s.email as staff_email
    FROM time_off_requests tor
    JOIN staff s ON tor.staff_id = s.id
    WHERE s.tenant_id = ${tenantId}
  `
  
  if (status) {
    query = sql`${query} AND tor.status = ${status}`
  }
  
  query = sql`${query} ORDER BY tor.created_at DESC`
  
  const result = await db.execute(query)
  return result.rows
}

export async function updateTimeOffRequest(requestId: string, status: string, approvedBy: string) {
  const result = await db.execute(sql`
    UPDATE time_off_requests 
    SET status = ${status}, 
        approved_by = ${approvedBy}, 
        approved_at = NOW(),
        updated_at = NOW()
    WHERE id = ${requestId}
    RETURNING *
  `)
  return result.rows[0]
}