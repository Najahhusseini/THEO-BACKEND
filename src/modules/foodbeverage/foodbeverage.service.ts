import { db } from '../../db';
import { orders, orderItems, staff, stays } from '../../db/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { addFolioItemByStayId } from '../folio/folio.service';

export class FoodBeverageService {
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

    // If still no stayId, order can still be created (e.g., table service) but won't post to folio later
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
    // Use a database transaction to ensure atomicity
    return await db.transaction(async (tx) => {
      // Lock the order row to prevent race conditions
      const existingOrder = await tx.select().from(orders).where(
        and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))
      ).forUpdate().limit(1);

      if (!existingOrder.length) throw new Error('Order not found');
      if (existingOrder[0].status === 'completed') {
        // Already completed – idempotent
        return { success: true, alreadyCompleted: true };
      }
      if (existingOrder[0].status === 'cancelled' && status === 'completed') {
        throw new Error('Cannot complete a cancelled order');
      }

      const updateData: any = { status };
      if (status === 'completed') updateData.completedAt = new Date();
      await tx.update(orders)
        .set(updateData)
        .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));

      if (status === 'completed') {
        // Fetch order with items inside the same transaction
        const order = await tx.query.orders.findFirst({
          where: eq(orders.id, orderId),
          with: { items: true },
        });
        if (order?.stayId) {
          const description = `${order.orderType === 'restaurant' ? 'Restaurant' : 'Bar'} order #${order.id.slice(0,8)}`;
          // Pass the transaction client to the folio service
          await addFolioItemByStayId(order.stayId, description, Number(order.totalAmount), order.orderType, tx);
        }
      }
      return { success: true, alreadyCompleted: false };
    });
  }

  async assignOrder(orderId: string, tenantId: string, staffId: string) {
    await db.update(orders)
      .set({ assignedToStaffId: staffId })
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));
    return { success: true };
  }

  // Role‑based queries (unchanged)
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