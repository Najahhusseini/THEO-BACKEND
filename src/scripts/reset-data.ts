import { db } from '../db/index'
import { sql } from 'drizzle-orm'
import 'dotenv/config'
import * as bcrypt from 'bcryptjs'

async function resetData() {
    console.log('🔄 Resetting database...')
    
    try {
        // Clear all tables
        await db.execute(sql`TRUNCATE TABLE cleaning_messages RESTART IDENTITY CASCADE`)
        await db.execute(sql`TRUNCATE TABLE supply_requests RESTART IDENTITY CASCADE`)
        await db.execute(sql`TRUNCATE TABLE cleaning_requests RESTART IDENTITY CASCADE`)
        await db.execute(sql`TRUNCATE TABLE room_status_events RESTART IDENTITY CASCADE`)
        await db.execute(sql`TRUNCATE TABLE tasks RESTART IDENTITY CASCADE`)
        await db.execute(sql`TRUNCATE TABLE attendance RESTART IDENTITY CASCADE`)
        await db.execute(sql`TRUNCATE TABLE notifications RESTART IDENTITY CASCADE`)
        await db.execute(sql`TRUNCATE TABLE notification_subscriptions RESTART IDENTITY CASCADE`)
        await db.execute(sql`TRUNCATE TABLE rooms RESTART IDENTITY CASCADE`)
        await db.execute(sql`TRUNCATE TABLE staff RESTART IDENTITY CASCADE`)
        await db.execute(sql`TRUNCATE TABLE tenants RESTART IDENTITY CASCADE`)
        console.log('✅ Tables cleared')
        
        // Create hotel
        const hashedPassword = await bcrypt.hash('admin123', 10)
        const hotelResult = await db.execute(sql`
            INSERT INTO tenants (name, subdomain)
            VALUES ('Demo Hotel', 'demo')
            RETURNING id
        `)
        const tenantId = hotelResult.rows[0].id
        console.log('✅ Hotel created')
        
        // Create staff
        const adminResult = await db.execute(sql`
            INSERT INTO staff (tenant_id, email, name, role, password_hash)
            VALUES (${tenantId}, 'admin@demohotel.com', 'Admin', 'admin', ${hashedPassword})
            RETURNING id
        `)
        const adminId = adminResult.rows[0].id
        
        const headResult = await db.execute(sql`
            INSERT INTO staff (tenant_id, email, name, role, password_hash)
            VALUES (${tenantId}, 'head@demohotel.com', 'Sarah Head', 'head_housekeeping', ${hashedPassword})
            RETURNING id
        `)
        const headId = headResult.rows[0].id
        
        const mariaResult = await db.execute(sql`
            INSERT INTO staff (tenant_id, email, name, role, password_hash)
            VALUES (${tenantId}, 'maria@demohotel.com', 'Maria Housekeeper', 'housekeeping', ${hashedPassword})
            RETURNING id
        `)
        const mariaId = mariaResult.rows[0].id
        
        const johnResult = await db.execute(sql`
            INSERT INTO staff (tenant_id, email, name, role, password_hash)
            VALUES (${tenantId}, 'john@demohotel.com', 'John Cleaner', 'housekeeping', ${hashedPassword})
            RETURNING id
        `)
        const johnId = johnResult.rows[0].id
        
        console.log('✅ Staff created')
        console.log('   - Admin: admin@demohotel.com')
        console.log('   - Head: head@demohotel.com')
        console.log('   - Maria: maria@demohotel.com')
        console.log('   - John: john@demohotel.com')
        
        // Create 30 rooms (3 floors x 10 rooms)
        const roomTypes = ['Standard', 'Deluxe', 'Suite', 'Family', 'Executive']
        let roomCount = 0
        
        for (let floor = 1; floor <= 3; floor++) {
            for (let i = 1; i <= 10; i++) {
                const roomNum = floor * 100 + i
                const roomType = roomTypes[roomNum % roomTypes.length]
                await db.execute(sql`
                    INSERT INTO rooms (tenant_id, room_number, floor, room_type, cleaning_status)
                    VALUES (${tenantId}, ${roomNum.toString()}, ${floor}, ${roomType}, 'dirty')
                `)
                roomCount++
            }
        }
        console.log(`✅ ${roomCount} rooms created`)
        
        // Get some rooms to assign
        const roomsResult = await db.execute(sql`SELECT id, room_number FROM rooms LIMIT 4`)
        
        if (roomsResult.rows.length >= 2) {
            // Assign first room to Maria (without created_at/updated_at)
            await db.execute(sql`
                UPDATE rooms SET assigned_cleaner_id = ${mariaId} WHERE id = ${roomsResult.rows[0].id}
            `)
            await db.execute(sql`
                INSERT INTO cleaning_requests (room_id, request_type, status, assigned_to)
                VALUES (${roomsResult.rows[0].id}, 'checkout', 'assigned', ${mariaId})
            `)
            console.log(`   - Room ${roomsResult.rows[0].room_number} assigned to Maria`)
            
            // Assign second room to John
            await db.execute(sql`
                UPDATE rooms SET assigned_cleaner_id = ${johnId} WHERE id = ${roomsResult.rows[1].id}
            `)
            await db.execute(sql`
                INSERT INTO cleaning_requests (room_id, request_type, status, assigned_to)
                VALUES (${roomsResult.rows[1].id}, 'stay_over', 'assigned', ${johnId})
            `)
            console.log(`   - Room ${roomsResult.rows[1].room_number} assigned to John`)
        }
        
        console.log('\n' + '='.repeat(50))
        console.log('✨ RESET COMPLETE! ✨')
        console.log('='.repeat(50))
        console.log('\n📋 Login Credentials (password: admin123):')
        console.log('   Admin:        admin@demohotel.com')
        console.log('   Head of HK:   head@demohotel.com')
        console.log('   Cleaner 1:    maria@demohotel.com')
        console.log('   Cleaner 2:    john@demohotel.com')
        console.log('\n📊 Sample Assignments:')
        console.log('   - 2 rooms pre-assigned to cleaners for testing')
        console.log('   - All other rooms start as DIRTY')
        console.log('\n🚀 You can now test the real-time sync!')
        
        process.exit(0)
        
    } catch (error) {
        console.error('❌ Reset failed:', error)
        process.exit(1)
    }
}

resetData()