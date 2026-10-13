import { createDatabasePool } from '../src/server/db/pool.js';
import { migrate } from '../src/server/db/migrate.js';
if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL is required');
const pool = createDatabasePool(process.env.DATABASE_URL);
try {
    await migrate(pool);
    console.log('Database migrations applied.');
}
finally {
    await pool.end();
}
