const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    password: 'theo123',
    database: 'theo_mini',
    host: 'localhost',
    port: 5432
});

async function resetPasswords() {
    const password = 'admin123';
    const hash = bcrypt.hashSync(password, 10);
    
    console.log('Generated hash:', hash);
    
    // Update head of housekeeping
    await pool.query(
        "UPDATE staff SET password_hash = $1 WHERE email = $2",
        [hash, 'housekeeping@demohotel.com']
    );
    
    // Update regular housekeeping staff
    await pool.query(
        "UPDATE staff SET password_hash = $1 WHERE role = 'housekeeping'",
        [hash]
    );
    
    console.log('✅ Passwords reset to: admin123');
    console.log('Updated users:');
    console.log('  - housekeeping@demohotel.com (Head of Housekeeping)');
    console.log('  - hallway@demohotel.com');
    console.log('  - laundry@demohotel.com');
    console.log('  - general@demohotel.com');
    
    await pool.end();
}

resetPasswords().catch(console.error);