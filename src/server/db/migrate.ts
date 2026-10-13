import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { withTransaction } from './transaction.js';
export async function migrate(pool: Pool): Promise<void> {
    const directory = resolve('db/migrations');
    const files = (await readdir(directory)).filter(file => /^\d+.*\.sql$/.test(file)).sort();
    await withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('campaign_guard:migrations'))");
        await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp())');
        for (const name of files) {
            const sql = await readFile(resolve(directory, name), 'utf8');
            const checksum = createHash('sha256').update(sql).digest('hex');
            const existing = await client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name]);
            if (existing.rowCount) {
                if (existing.rows[0].checksum !== checksum)
                    throw new Error(`Applied migration changed: ${name}`);
                continue;
            }
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations(name,checksum) VALUES ($1,$2)', [name, checksum]);
        }
    });
}
