const { db } = require('./src/db/index');
const { sql } = require('drizzle-orm');
const bcrypt = require('bcryptjs');

async function createUser() {
  try {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    
    const tenantResult = await db.execute(sql`SELECT id FROM tenants LIMIT 1`);
    if (tenantResult.rows.length === 0) {
      console.error('❌ No tenant found.');
      process.exit(1);
    }
    
    const tenantId = tenantResult.rows[0].id;
    
    await db.execute(sql`
      INSERT INTO staff (tenant_id, email, name, role, password_hash, active, created_at, updated_at)
      VALUES (${tenantId}, 'reservations@demohotel.com', 'Reservation Manager', 'reservation_manager', ${hashedPassword}, true, NOW(), NOW())
      ON CONFLICT (email) DO NOTHING
    `);
    
    console.log('✅ Reservation Manager user created successfully!');
    console.log('   Email: reservations@demohotel.com');
    console.log('   Password: admin123');
    process.exit(0);
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

createUser();