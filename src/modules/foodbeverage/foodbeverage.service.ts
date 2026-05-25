import { db } from '../../db';
import { orders, orderItems, staff, stays } from '../../db/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { addFolioItemByStayId } from '../folio/folio.service';

export class FoodBeverageService {
  // Create order with optional assignment
  async createOrder(data: {
  tenantId: string;
  type: 'restaurant' | 'bar';
  roomNumber?: string;
  tableNumber?: string;
  guestId?: string;
  stayId?: string;
  items: { name: string; quantity: number; unitPrice: number }[];
  createdBy: string;
  assignedTo?: string;
}) {
  // If roomNumber given but no stayId, try to find the active stay
  let finalStayId = data.stayId;
  if (data.roomNumber && !finalStayId) {
    const activeStay = await db.select().from(stays).where(
      and(
        eq(stays.roomNumber, data.roomNumber),
        eq(stays.status, 'checked_in'),
        eq(stays.tenantId, data.tenantId)
      )
    ).limit(1);
    if (activeStay.length) {
      finalStayId = activeStay[0].id;
    }
  }

  const total = data.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const [order] = await db.insert(orders).values({
    tenantId: data.tenantId,
    orderType: data.type,
    status: 'pending',
    roomNumber: data.roomNumber,
    tableNumber: data.tableNumber,
    guestId: data.guestId,
    stayId: finalStayId,
    totalAmount: total,
    createdBy: data.createdBy,
    assignedToStaffId: data.assignedTo,
  }).returning();

  for (const item of data.items) {
    await db.insert(orderItems).values({
      orderId: order.id,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.quantity * item.unitPrice,
    });
  }
  return order;
}

  async updateOrderStatus(orderId: string, tenantId: string, status: 'in_progress' | 'completed' | 'cancelled', staffId?: string) {
    const updateData: any = { status };
    if (status === 'completed') updateData.completedAt = new Date();
    await db.update(orders)
      .set(updateData)
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));

    if (status === 'completed') {
      const order = await db.query.orders.findFirst({
        where: eq(orders.id, orderId),
        with: { items: true },
      });
      if (order?.stayId) {
        const description = `${order.orderType === 'restaurant' ? 'Restaurant' : 'Bar'} order #${order.id.slice(0,8)}`;
        await addFolioItemByStayId(order.stayId, description, Number(order.totalAmount), order.orderType);
      }
    }
    return { success: true };
  }

  async assignOrder(orderId: string, tenantId: string, staffId: string) {
    await db.update(orders)
      .set({ assignedToStaffId: staffId })
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));
    return { success: true };
  }

  // Role‑based queries
  async getKitchenOrders(tenantId: string, statusFilter?: string) {
    let query = db.select().from(orders).where(and(
      eq(orders.tenantId, tenantId),
      eq(orders.orderType, 'restaurant')
    ));
    if (statusFilter && statusFilter !== 'all') {
      query = query.where(eq(orders.status, statusFilter));
    }
    return await query.orderBy(desc(orders.createdAt));
  }

  async getBarOrders(tenantId: string, statusFilter?: string) {
    let query = db.select().from(orders).where(and(
      eq(orders.tenantId, tenantId),
      eq(orders.orderType, 'bar')
    ));
    if (statusFilter && statusFilter !== 'all') {
      query = query.where(eq(orders.status, statusFilter));
    }
    return await query.orderBy(desc(orders.createdAt));
  }

  async getStaffOrders(tenantId: string, staffId: string, orderType?: 'restaurant' | 'bar') {
    let query = db.select().from(orders).where(and(
      eq(orders.tenantId, tenantId),
      eq(orders.assignedToStaffId, staffId)
    ));
    if (orderType) query = query.where(eq(orders.orderType, orderType));
    return await query.orderBy(desc(orders.createdAt));
  }

  async getAllOrders(tenantId: string, type?: string, status?: string) {
    let query = db.select().from(orders).where(eq(orders.tenantId, tenantId));
    if (type && type !== 'all') query = query.where(eq(orders.orderType, type));
    if (status && status !== 'all') query = query.where(eq(orders.status, status));
    return await query.orderBy(desc(orders.createdAt));
  }

  async getOrderById(orderId: string, tenantId: string) {
    return await db.query.orders.findFirst({
      where: and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)),
      with: { items: true },
    });
  }
}