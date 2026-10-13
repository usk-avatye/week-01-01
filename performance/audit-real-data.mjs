import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';

const label = process.argv[2];
assert.ok(['before', 'after'].includes(label));
const output = process.argv[3] ?? 'performance/results/verification';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
    await client.connect(); await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tables = {};
    for (const table of ['members', 'sessions', 'campaigns', 'executions', 'schema_migrations']) {
        tables[table] = (await client.query(`SELECT COUNT(*)::integer AS rows,
            md5(COALESCE(string_agg(md5(row_to_json(t)::text),'' ORDER BY row_to_json(t)::text),'')) AS fingerprint
            FROM public.${table} t`)).rows[0];
    }
    await client.query('COMMIT');
    await writeFile(`${output}/real-data-${label}.json`, JSON.stringify({ at: new Date().toISOString(), readOnly: true, tables }, null, 2) + '\n');
    console.log(JSON.stringify({ label, tables }));
} finally { await client.end(); }
