import { db } from '../../db'
import { rooms, roomStatusEvents, staff } from '../../db/schema'
import { eq, asc, desc } from 'drizzle-orm'

export async function getRoomsByTenant(tenantId: string) {
  const allRooms = await db.select()
    .from(rooms)
    .where(eq(rooms.tenantId, tenantId))
    .orderBy(asc(rooms.roomNumber))
  
  // For each room, get the latest status change with staff name
  const roomsWithLastUpdate = await Promise.all(
    allRooms.map(async (room) => {
      const lastEvent = await db.select({
        changedAt: roomStatusEvents.changedAt,
        staffName: staff.name,
        staffRole: staff.role,
      })
      .from(roomStatusEvents)
      .leftJoin(staff, eq(roomStatusEvents.changedByStaffId, staff.id))
      .where(eq(roomStatusEvents.roomId, room.id))
      .orderBy(desc(roomStatusEvents.changedAt))
      .limit(1)
      
      return {
        ...room,
        lastUpdatedBy: lastEvent[0]?.staffName || 'System',
        lastUpdatedRole: lastEvent[0]?.staffRole || 'auto',
        lastUpdatedAt: lastEvent[0]?.changedAt || room.lastStatusChange,
      }
    })
  )
  
  return roomsWithLastUpdate
}

export async function updateRoomStatus(roomId: string, newStatus: string, changedByStaffId: string) {
  // Get old status first
  const oldRoom = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1)
  
  if (!oldRoom[0]) {
    throw new Error('Room not found')
  }

  // Update room status
  await db.update(rooms)
    .set({ 
      status: newStatus as any, 
      lastStatusChange: new Date(),
      updatedAt: new Date()
    })
    .where(eq(rooms.id, roomId))

  // Log the status change with staff ID
  await db.insert(roomStatusEvents).values({
    roomId,
    oldStatus: oldRoom[0].status,
    newStatus: newStatus as any,
    changedByStaffId,
  })

  return { roomId, oldStatus: oldRoom[0].status, newStatus }
}