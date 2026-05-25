import { pgTable, uuid, text, timestamp, boolean, integer, pgEnum, jsonb, varchar, decimal } from 'drizzle-orm/pg-core'

// Enums
export const staffRoleEnum = pgEnum('staff_role', [
  'admin', 'manager', 'frontdesk', 'housekeeping', 'head_housekeeping',
  'maintenance', 'head_maintenance',
  'kitchen_head', 'kitchen_staff', 'bar_head', 'bar_staff'
])
export const roomStatusEnum = pgEnum('room_status', ['dirty', 'cleaning', 'ready', 'inspected'])
export const taskStatusEnum = pgEnum('task_status', ['pending', 'in_progress', 'completed', 'escalated'])
export const taskPriorityEnum = pgEnum('task_priority', ['low', 'medium', 'high'])

// Tenants table (hotels)
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  subdomain: text('subdomain').notNull().unique(),
  logoUrl: text('logo_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Staff table
export const staff = pgTable('staff', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: staffRoleEnum('role').notNull(),
  phone: text('phone'),
  active: boolean('active').default(true),
  passwordHash: text('password_hash'),
  isSuperAdmin: boolean('is_super_admin').default(false),
  amenities: text('amenities').array(), // optional: store amenity list
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Rooms table
export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  roomNumber: text('room_number').notNull(),
  floor: integer('floor'),
  roomType: text('room_type'),
  status: roomStatusEnum('status').default('dirty').notNull(),
  price_per_night: decimal('price_per_night', { precision: 10, scale: 2 }),
  notes: jsonb('notes'), // operational sticky notes
  lastStatusChange: timestamp('last_status_change').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  // Out of Order fields
  outOfOrder: boolean('out_of_order').default(false).notNull(),
  outOfOrderReason: text('out_of_order_reason'),
  outOfOrderSince: timestamp('out_of_order_since'),
  outOfOrderSetBy: uuid('out_of_order_set_by').references(() => staff.id),
})

// Room status history (audit log)
export const roomStatusEvents = pgTable('room_status_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'cascade' }).notNull(),
  oldStatus: roomStatusEnum('old_status'),
  newStatus: roomStatusEnum('new_status').notNull(),
  changedByStaffId: uuid('changed_by_staff_id').references(() => staff.id),
  changedAt: timestamp('changed_at').defaultNow().notNull(),
})

// Tasks table
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull(),
  description: text('description'),
  status: taskStatusEnum('status').default('pending').notNull(),
  priority: taskPriorityEnum('priority').default('medium').notNull(),
  assignedToStaffId: uuid('assigned_to_staff_id').references(() => staff.id),
  createdByStaffId: uuid('created_by_staff_id').references(() => staff.id),
  roomId: uuid('room_id').references(() => rooms.id),
  dueAt: timestamp('due_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Attendance table (clock in/out)
export const attendance = pgTable('attendance', {
  id: uuid('id').primaryKey().defaultRandom(),
  staffId: uuid('staff_id').references(() => staff.id, { onDelete: 'cascade' }).notNull(),
  clockIn: timestamp('clock_in').defaultNow().notNull(),
  clockOut: timestamp('clock_out'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Audit Logs table
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  staffId: uuid('staff_id').references(() => staff.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: uuid('entity_id').notNull(),
  details: text('details'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Guests table (unified guest profiles)
export const guests = pgTable('guests', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  preferences: jsonb('preferences'),
  notes: jsonb('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Stays table (linked to reservations and rooms)
export const stays = pgTable('stays', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  reservationId: uuid('reservation_id').notNull(),
  roomNumber: text('room_number').notNull(),
  guestName: text('guest_name').notNull(),
  guestId: uuid('guest_id').references(() => guests.id),
  arrivalDate: timestamp('arrival_date').notNull(),
  departureDate: timestamp('departure_date').notNull(),
  status: text('status').default('confirmed'), // confirmed, checked_in, checked_out, cancelled
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Financial Events table (outbox)
export const financialEvents = pgTable('financial_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('pending'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Webhook configurations
export const webhookConfigurations = pgTable('webhook_configurations', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  secret: text('secret'),
  enabled: boolean('enabled').default(true).notNull(),
  retryCount: integer('retry_count').default(3).notNull(),
  retryDelaySeconds: integer('retry_delay_seconds').default(60).notNull(),
  timeoutSeconds: integer('timeout_seconds').default(10).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Orders table (Restaurant & Bar)
export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  orderType: varchar('order_type', { length: 20 }).notNull(), // 'restaurant', 'bar'
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  roomNumber: varchar('room_number', { length: 10 }),
  tableNumber: varchar('table_number', { length: 10 }),
  guestId: uuid('guest_id').references(() => guests.id),
  stayId: uuid('stay_id').references(() => stays.id),
  totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull(),
  createdBy: uuid('created_by').references(() => staff.id),
  assignedToStaffId: uuid('assigned_to_staff_id').references(() => staff.id), // ✅ Added this column
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
})

// Order items table
export const orderItems = pgTable('order_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).notNull(),
  total: decimal('total', { precision: 10, scale: 2 }).notNull(),
})

// Folios table (if not already defined elsewhere)
export const folios = pgTable('folios', {
  id: uuid('id').defaultRandom().primaryKey(),
  stayId: uuid('stay_id').notNull().references(() => stays.id, { onDelete: 'cascade' }),
  reservationId: uuid('reservation_id').notNull(),
  guestName: text('guest_name').notNull(),
  status: text('status').default('open'),
  closedAt: timestamp('closed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const folioItems = pgTable('folio_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  folioId: uuid('folio_id').notNull().references(() => folios.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  chargeType: text('charge_type').default('room_charge'),
  quantity: integer('quantity').default(1),
  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }),
  taxCode: text('tax_code'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// Types exports
export type FinancialEvent = typeof financialEvents.$inferSelect;
export type NewFinancialEvent = typeof financialEvents.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
export type Guest = typeof guests.$inferSelect;
export type Stay = typeof stays.$inferSelect;
export type Folio = typeof folios.$inferSelect;
export type FolioItem = typeof folioItems.$inferSelect;