import { pgTable, uuid, text, timestamp, boolean, integer, pgEnum } from 'drizzle-orm/pg-core'

// Enums
export const staffRoleEnum = pgEnum('staff_role', ['admin', 'manager', 'frontdesk', 'housekeeping', 'maintenance'])
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