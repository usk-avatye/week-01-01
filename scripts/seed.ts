import { createDatabasePool } from '../src/server/db/pool.js';
import { seedDemo } from '../src/server/db/seed-demo.js';
if (!process.env.DATABASE_URL || !process.env.DEMO_PASSWORD)
    throw new Error('DATABASE_URL and DEMO_PASSWORD are required');
const pool = createDatabasePool(process.env.DATABASE_URL);
try {
    await seedDemo(pool, process.env.DEMO_PASSWORD);
    console.log('Demo members and campaigns ready. Existing spend, counters and passwords retained.');
}
finally {
    await pool.end();
}
