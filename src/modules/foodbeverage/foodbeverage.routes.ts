import { Hono } from 'hono';
import { FoodBeverageService } from './foodbeverage.service';
import { authMiddleware, requireRole } from '../../middleware/auth';
import { db } from '../../db';        // ✅ ADD THIS
import { sql } from 'drizzle-orm';    // ✅ ADD THIS

const fbRouter = new Hono();
fbRouter.use('*', authMiddleware);

// Admin/manager overview
fbRouter.get('/orders', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('tenantId');
  const { type, status } = c.req.query();
  const service = new FoodBeverageService();
  const orders = await service.getAllOrders(tenantId, type, status);
  return c.json(orders);
});

// Kitchen board (kitchen_head)
fbRouter.get('/kitchen/orders', requireRole(['kitchen_head']), async (c) => {
  const tenantId = c.get('tenantId');
  const { status } = c.req.query();
  const service = new FoodBeverageService();
  const orders = await service.getKitchenOrders(tenantId, status);
  return c.json(orders);
});

// Bar board (bar_head)
fbRouter.get('/bar/orders', requireRole(['bar_head']), async (c) => {
  const tenantId = c.get('tenantId');
  const { status } = c.req.query();
  const service = new FoodBeverageService();
  const orders = await service.getBarOrders(tenantId, status);
  return c.json(orders);
});

// My assigned orders (for kitchen_staff, bar_staff, waiters)
fbRouter.get('/my-orders', async (c) => {
  const tenantId = c.get('tenantId');
  const user = c.get('user');
  const staffId = user.id;
  const { type } = c.req.query();
  const service = new FoodBeverageService();
  const orders = await service.getStaffOrders(tenantId, staffId, type as any);
  return c.json(orders);
});

// Create order (anyone with appropriate amenity)
fbRouter.post('/orders', async (c) => {
  const tenantId = c.get('tenantId');
  const user = c.get('user');
  const body = await c.req.json();
  const service = new FoodBeverageService();
  const order = await service.createOrder({
    ...body,
    tenantId,
    createdBy: user.id,
    assignedTo: body.assignedTo || null,
  });
  return c.json(order, 201);
});

// Update status
fbRouter.patch('/orders/:id/status', async (c) => {
  const tenantId = c.get('tenantId');
  const user = c.get('user');
  const { id } = c.req.param();
  const { status } = await c.req.json();
  const service = new FoodBeverageService();
  await service.updateOrderStatus(id, tenantId, status, user.id);
  return c.json({ message: 'Status updated' });
});

// Assign order to staff
fbRouter.post('/orders/:id/assign', requireRole(['kitchen_head', 'bar_head', 'admin', 'manager']), async (c) => {
  const tenantId = c.get('tenantId');
  const { id } = c.req.param();
  const { staffId } = await c.req.json();
  const service = new FoodBeverageService();
  await service.assignOrder(id, tenantId, staffId);
  return c.json({ message: 'Order assigned' });
});

// Get single order
fbRouter.get('/orders/:id', async (c) => {
  const tenantId = c.get('tenantId');
  const { id } = c.req.param();
  const service = new FoodBeverageService();
  const order = await service.getOrderById(id, tenantId);
  if (!order) return c.json({ error: 'Not found' }, 404);
  return c.json(order);
});

// ✅ NEW: Kitchen Meal Planner endpoint
fbRouter.get('/kitchen/meal-plans', requireRole(['kitchen_head', 'kitchen_staff']), async (c) => {
  const tenantId = c.get('tenantId');
  try {
    const result = await db.execute(sql`
      SELECT 
        s.id as stay_id,
        s.room_number,
        s.guest_name,
        s.meal_plan,
        s.food_requests,
        s.food_requests_acknowledged,
        s.arrival_date,
        s.departure_date
      FROM stays s
      WHERE s.tenant_id = ${tenantId}
        AND s.status = 'checked_in'
      ORDER BY s.room_number
    `);
    return c.json(result.rows);
  } catch (err: any) {
    console.error('Meal plans error:', err);
    return c.json({ error: err.message }, 500);
  }
});

// ✅ NEW: Acknowledge food request
fbRouter.post('/kitchen/acknowledge-request', requireRole(['kitchen_head', 'kitchen_staff']), async (c) => {
  const { stayId } = await c.req.json();
  await db.execute(sql`
    UPDATE stays SET food_requests_acknowledged = true WHERE id = ${stayId}
  `);
  return c.json({ success: true });
});

export default fbRouter;