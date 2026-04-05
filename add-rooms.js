const { Pool } = require('pg');
require('dotenv/config');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function addRooms() {
  const client = await pool.connect();
  try {
    // Get the demo hotel tenant ID
    const tenantResult = await client.query("SELECT id FROM tenants WHERE subdomain = 'demo'");
    const tenantId = tenantResult.rows[0].id;
    
    console.log('Adding rooms for Floor 2, 3, and 4...');
    
    // Rooms for Floor 2 (201-210)
    const floor2Rooms = [
      { number: '201', type: 'Standard', floor: 2 },
      { number: '202', type: 'Deluxe', floor: 2 },
      { number: '203', type: 'Suite', floor: 2 },
      { number: '204', type: 'Family', floor: 2 },
      { number: '205', type: 'Executive', floor: 2 },
      { number: '206', type: 'Standard', floor: 2 },
      { number: '207', type: 'Deluxe', floor: 2 },
      { number: '208', type: 'Suite', floor: 2 },
      { number: '209', type: 'Family', floor: 2 },
      { number: '210', type: 'Executive', floor: 2 },
    ];
    
    // Rooms for Floor 3 (301-310)
    const floor3Rooms = [
      { number: '301', type: 'Standard', floor: 3 },
      { number: '302', type: 'Deluxe', floor: 3 },
      { number: '303', type: 'Suite', floor: 3 },
      { number: '304', type: 'Family', floor: 3 },
      { number: '305', type: 'Executive', floor: 3 },
      { number: '306', type: 'Standard', floor: 3 },
      { number: '307', type: 'Deluxe', floor: 3 },
      { number: '308', type: 'Suite', floor: 3 },
      { number: '309', type: 'Family', floor: 3 },
      { number: '310', type: 'Executive', floor: 3 },
    ];
    
    // Rooms for Floor 4 (401-405)
    const floor4Rooms = [
      { number: '401', type: 'Presidential Suite', floor: 4 },
      { number: '402', type: 'Presidential Suite', floor: 4 },
      { number: '403', type: 'Penthouse', floor: 4 },
      { number: '404', type: 'Penthouse', floor: 4 },
      { number: '405', type: 'Royal Suite', floor: 4 },
    ];
    
    const allRooms = [...floor2Rooms, ...floor3Rooms, ...floor4Rooms];
    
    for (const room of allRooms) {
      await client.query(
        `INSERT INTO rooms (tenant_id, room_number, floor, room_type, status) 
         VALUES ($1, $2, $3, $4, $5) 
         ON CONFLICT DO NOTHING`,
        [tenantId, room.number, room.floor, room.type, 'dirty']
      );
      console.log(`Added Room ${room.number} (Floor ${room.floor})`);
    }
    
    console.log(`\n✅ Added ${allRooms.length} new rooms!`);
    console.log('Total rooms now: 15 (Floor 1) + 25 (Floors 2-4) = 40 rooms');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

addRooms();