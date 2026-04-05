import { db } from '../../db'
import { sql } from 'drizzle-orm'

export async function getShiftTypes() {
  const result = await db.execute(sql`
    SELECT * FROM shift_types ORDER BY sort_order
  `)
  return result.rows
}

export async function getStaffForTenant(tenantId: string) {
  const result = await db.execute(sql`
    SELECT id, name, role, email FROM staff 
    WHERE tenant_id = ${tenantId} AND active = true 
    ORDER BY name
  `)
  return result.rows
}

export async function getWeeklySchedule(tenantId: string, weekStartDate: string) {
  // Get or create schedule for this week
  let schedule = await db.execute(sql`
    SELECT * FROM weekly_schedules 
    WHERE tenant_id = ${tenantId} AND week_start_date = ${weekStartDate}
  `)
  
  if (schedule.rows.length === 0) {
    const weekEnd = new Date(weekStartDate)
    weekEnd.setDate(weekEnd.getDate() + 6)
    
    const newSchedule = await db.execute(sql`
      INSERT INTO weekly_schedules (tenant_id, week_start_date, week_end_date)
      VALUES (${tenantId}, ${weekStartDate}, ${weekEnd.toISOString().split('T')[0]})
      RETURNING *
    `)
    schedule = newSchedule
  }
  
  // Get shifts for this schedule
  const shifts = await db.execute(sql`
    SELECT 
      ss.*,
      s.name as staff_name,
      s.role as staff_role,
      st.name as shift_name,
      st.code as shift_code,
      st.start_time,
      st.end_time,
      st.color
    FROM schedule_shifts ss
    JOIN staff s ON ss.staff_id = s.id
    JOIN shift_types st ON ss.shift_type_id = st.id
    WHERE ss.schedule_id = ${schedule.rows[0].id}
  `)
  
  return {
    schedule: schedule.rows[0],
    shifts: shifts.rows,
  }
}

export async function saveScheduleShifts(
  scheduleId: string,
  shifts: { staffId: string; shiftTypeId: string; shiftDate: string; notes?: string }[]
) {
  // Delete existing shifts for this schedule
  await db.execute(sql`
    DELETE FROM schedule_shifts WHERE schedule_id = ${scheduleId}
  `)
  
  // Insert new shifts
  for (const shift of shifts) {
    await db.execute(sql`
      INSERT INTO schedule_shifts (schedule_id, staff_id, shift_type_id, shift_date, notes)
      VALUES (${scheduleId}, ${shift.staffId}, ${shift.shiftTypeId}, ${shift.shiftDate}, ${shift.notes || null})
    `)
  }
  
  return { success: true, count: shifts.length }
}

export async function publishSchedule(scheduleId: string) {
  const result = await db.execute(sql`
    UPDATE weekly_schedules SET published = TRUE WHERE id = ${scheduleId} RETURNING *
  `)
  return result.rows[0]
}

export async function getStaffSchedule(staffId: string, weekStartDate?: string) {
  if (!weekStartDate) {
    // Get current week start (Monday)
    const today = new Date()
    const day = today.getDay()
    const diff = today.getDate() - day + (day === 0 ? -6 : 1)
    weekStartDate = new Date(today.setDate(diff)).toISOString().split('T')[0]
  }
  
  const result = await db.execute(sql`
    SELECT 
      ws.week_start_date,
      ws.week_end_date,
      ss.shift_date,
      st.name as shift_name,
      st.code as shift_code,
      st.start_time,
      st.end_time,
      st.color,
      ss.notes
    FROM weekly_schedules ws
    JOIN schedule_shifts ss ON ws.id = ss.schedule_id
    JOIN shift_types st ON ss.shift_type_id = st.id
    WHERE ss.staff_id = ${staffId} AND ws.week_start_date = ${weekStartDate}
    ORDER BY ss.shift_date, st.start_time
  `)
  
  return result.rows
}

// Get expected arrivals for a week based on room data
export async function getExpectedArrivals(tenantId: string, weekStartDate: string) {
  const weekEnd = new Date(weekStartDate)
  weekEnd.setDate(weekEnd.getDate() + 7)
  const weekEndStr = weekEnd.toISOString().split('T')[0]
  
  // Get rooms that are expected to have arrivals based on room status
  // Rooms that are 'ready' or 'inspected' indicate they're available for new guests
  const result = await db.execute(sql`
    SELECT 
      DATE(r.last_status_change) as date,
      COUNT(*) as arrival_count
    FROM rooms r
    WHERE r.tenant_id = ${tenantId}
      AND r.status IN ('ready', 'inspected')
      AND DATE(r.last_status_change) >= ${weekStartDate}
      AND DATE(r.last_status_change) < ${weekEndStr}
    GROUP BY DATE(r.last_status_change)
    ORDER BY date
  `)
  
  // Create a map of dates to arrival counts
  const arrivalMap = new Map()
  for (const row of result.rows) {
    arrivalMap.set(row.date, parseInt(row.arrival_count))
  }
  
  // Generate all days of the week
  const weekDays = []
  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStartDate)
    date.setDate(date.getDate() + i)
    const dateStr = date.toISOString().split('T')[0]
    const count = arrivalMap.get(dateStr) || 0
    weekDays.push({
      date: dateStr,
      count: count,
      isHeavy: count > 20
    })
  }
  
  return weekDays
}