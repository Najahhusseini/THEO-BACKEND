export async function getExpectedArrivals(tenantId: string, weekStartDate: string) {
  const weekEnd = new Date(weekStartDate)
  weekEnd.setDate(weekEnd.getDate() + 7)
  const weekEndStr = weekEnd.toISOString().split('T')[0]
  
  // Get actual bookings for the week
  const result = await db.execute(sql`
    SELECT 
      check_in_date as date,
      COUNT(*) as arrival_count
    FROM bookings
    WHERE tenant_id = ${tenantId}
      AND check_in_date >= ${weekStartDate}
      AND check_in_date < ${weekEndStr}
    GROUP BY check_in_date
    ORDER BY date
  `)
  
  const arrivalMap = new Map()
  for (const row of result.rows) {
    arrivalMap.set(row.date, parseInt(row.arrival_count))
  }
  
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