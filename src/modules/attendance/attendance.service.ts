import { db } from '../../db'
import { sql } from 'drizzle-orm'

// Clock in
export async function clockIn(staffId: string) {
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
    INSERT INTO attendance (staff_id, clock_in) 
    VALUES (${staffId}, NOW()) 
    RETURNING *
  `)
  
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

// Get current status
export async function getCurrentStatus(staffId: string) {
  const activeShift = await db.execute(sql`
    SELECT id, clock_in, clock_out FROM attendance 
    WHERE staff_id = ${staffId} 
    AND clock_out IS NULL 
    ORDER BY clock_in DESC 
    LIMIT 1
  `)
  
  return {
    isClockedIn: activeShift.rows.length > 0,
    shift: activeShift.rows[0] || null,
  }
}

// Get today's attendance for a tenant
export async function getTodayAttendance(tenantId: string) {
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
  
  // Process results
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

// Get weekly hours
export async function getWeeklyHours(staffId: string) {
  const startOfWeek = new Date()
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay())
  startOfWeek.setHours(0, 0, 0, 0)
  
  const result = await db.execute(sql`
    SELECT 
      DATE(clock_in) as day,
      EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600 as hours
    FROM attendance 
    WHERE staff_id = ${staffId} 
      AND clock_in >= ${startOfWeek.toISOString()}
      AND clock_out IS NOT NULL
  `)
  
  const totalHours = result.rows.reduce((sum, row) => sum + (parseFloat(row.hours) || 0), 0)
  
  return {
    daily: result.rows.map(row => ({ day: row.day, hoursWorked: parseFloat(row.hours) || 0, overtimeHours: 0 })),
    totalHours: totalHours,
    totalOvertime: 0,
    remainingHours: Math.max(0, 40 - totalHours),
  }
}

// Get shift history
export async function getShiftHistory(staffId: string, days: number = 30) {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)
  
  const result = await db.execute(sql`
    SELECT * FROM attendance 
    WHERE staff_id = ${staffId} 
      AND clock_in >= ${startDate.toISOString()}
    ORDER BY clock_in DESC
  `)
  
  return result.rows
}

// Placeholder functions
export async function requestTimeOff(staffId: string, startDate: Date, endDate: Date, reason: string) {
  return { success: true, message: 'Request submitted' }
}

export async function getTimeOffRequests(tenantId: string, status?: string) {
  return []
}

export async function updateTimeOffRequest(requestId: string, status: string, approvedBy: string) {
  return { success: true }
}