import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../../src/server/db/migrate.js';
export async function createFixture() {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || !new URL(url).pathname.endsWith('_test'))
        throw new Error('A dedicated TEST_DATABASE_URL ending in _test is required');
    const root = new pg.Pool({ connectionString: url });
    const schema = `test_${randomBytes(8).toString('hex')}`;
    await root.query(`CREATE SCHEMA "${schema}"`);
    const pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, application_name: schema, max: 30 });
    try {
        await migrate(pool);
    }
    catch (error) {
        await pool.end();
        await root.query(`DROP SCHEMA "${schema}" CASCADE`);
        await root.end();
        throw error;
    }
    return { pool, schema, async close() {
            await pool.end();
            await root.query(`DROP SCHEMA "${schema}" CASCADE`);
            await root.end();
        } };
}
