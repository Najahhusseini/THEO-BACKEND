import { db } from './index'
import { tenants, staff, rooms } from './schema'
import { hashPassword } from '../modules/auth/auth.service'
import 'dotenv/config'

async function seed() {
  console.log('Seeding database...')

  // Insert a demo hotel
  const [demoHotel] = await db.insert(tenants).values({
    name: 'Demo Hotel',
    subdomain: 'demo',
  }).returning()

  console.log(`✓ Created hotel: ${demoHotel.name} (ID: ${demoHotel.id})`)

  // Hash password for all demo users (password is "admin123")
  const hashedPassword = await hashPassword('admin123')

  // Insert admin user
  const [admin] = await db.insert(staff).values({
    tenantId: demoHotel.id,
    email: 'admin@demohotel.com',
    name: 'Hotel Admin',
    role: 'admin',
    passwordHash: hashedPassword,
  }).returning()

  console.log(`✓ Created admin: ${admin.email} (password: admin123)`)

  // Insert manager
  const [manager] = await db.insert(staff).values({
    tenantId: demoHotel.id,
    email: 'manager@demohotel.com',
    name: 'Operations Manager',
    role: 'manager',
    passwordHash: hashedPassword,
  }).returning()

  console.log(`✓ Created manager: ${manager.email}`)

  // Insert housekeeping staff
  const [housekeeper] = await db.insert(staff).values({
    tenantId: demoHotel.id,
    email: 'housekeeping@demohotel.com',
    name: 'Maria Housekeeper',
    role: 'housekeeping',
    passwordHash: hashedPassword,
  }).returning()

  console.log(`✓ Created housekeeper: ${housekeeper.email}`)

  // Insert front desk staff
  const [frontdesk] = await db.insert(staff).values({
    tenantId: demoHotel.id,
    email: 'frontdesk@demohotel.com',
    name: 'John Frontdesk',
    role: 'frontdesk',
    passwordHash: hashedPassword,
  }).returning()

  console.log(`✓ Created front desk: ${frontdesk.email}`)

  // Insert maintenance staff
  const [maintenance] = await db.insert(staff).values({
    tenantId: demoHotel.id,
    email: 'maintenance@demohotel.com',
    name: 'Mike Maintenance',
    role: 'maintenance',
    passwordHash: hashedPassword,
  }).returning()

  console.log(`✓ Created maintenance: ${maintenance.email}`)

  // Create 15 demo rooms
  const roomTypes = ['Standard', 'Deluxe', 'Suite', 'Family', 'Executive']
  const statuses = ['dirty', 'cleaning', 'ready', 'inspected']
  
  for (let i = 101; i <= 115; i++) {
    const roomType = roomTypes[i % roomTypes.length]
    const status = statuses[i % statuses.length]
    
    await db.insert(rooms).values({
      tenantId: demoHotel.id,
      roomNumber: i.toString(),
      floor: Math.floor(i / 100),
      roomType: roomType,
      status: status as any,
    })
  }

  console.log(`✓ Created 15 demo rooms (101-115)`)

  console.log('\n✅ Seeding complete!')
  console.log('\n📋 Login credentials:')
  console.log('   Hotel subdomain: demo')
  console.log('   Email: admin@demohotel.com')
  console.log('   Password: admin123')
  console.log('\n   Or try:')
  console.log('   manager@demohotel.com / admin123')
  console.log('   housekeeping@demohotel.com / admin123')
  console.log('   frontdesk@demohotel.com / admin123')
  
  process.exit(0)
}

seed().catch((err) => {
  console.error('❌ Seeding failed:', err)
  process.exit(1)
})