import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDatabasePool } from '../dist/src/server/db/pool.js';
import { migrate } from '../dist/src/server/db/migrate.js';

export function requireTestDatabase(value) {
    if (!value || !new URL(value).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must end in _test');
    return value;
}
export async function createPerformanceFixture({ poolMax = 30 } = {}) {
    const base = requireTestDatabase(process.env.TEST_DATABASE_URL);
    const schema = `perf_${randomBytes(8).toString('hex')}`;
    const applicationName = `guard_${schema}`;
    const root = new pg.Pool({ connectionString: base, max: 1 });
    await root.query(`CREATE SCHEMA "${schema}"`);
    const scoped = new URL(base);
    scoped.searchParams.set('options', `-c search_path=${schema}`);
    scoped.searchParams.set('application_name', applicationName);
    const pool = createDatabasePool(scoped.toString(), poolMax);
    const observerUrl = new URL(scoped);
    observerUrl.searchParams.set('application_name', `observer_${schema}`);
    const observer = new pg.Pool({ connectionString: observerUrl.toString(), max: 1 });
    try { await migrate(pool); }
    catch (error) { await pool.end(); await observer.end(); await root.query(`DROP SCHEMA "${schema}" CASCADE`); await root.end(); throw error; }
    return { pool, observer, schema, applicationName, async close() {
        await pool.end(); await observer.end(); await root.query(`DROP SCHEMA "${schema}" CASCADE`); await root.end();
    } };
}
export async function setupWorkload(fixture, { scenario, ownerId, count }) {
    const start = performance.now();
    const { pool, schema } = fixture;
    assert.equal((await pool.query('SELECT current_schema() AS schema')).rows[0].schema, schema);
    await pool.query('TRUNCATE executions,campaigns RESTART IDENTITY');
    const legacy = (await pool.query(`SELECT 1 FROM information_schema.columns
        WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`, [schema, 'campaigns', 'last_execution_no'])).rowCount > 0;
    const sequence = (await pool.query('SELECT to_regclass($1) AS name', ['execution_no_seq'])).rows[0].name;
    if (sequence) await pool.query('SELECT setval($1::regclass,1,false)', ['execution_no_seq']);
    const numberOfCampaigns = scenario === 'B' ? 10 : 1;
    const campaigns = [];
    for (let index = 0; index < numberOfCampaigns; index++) {
        const row = (await pool.query(`INSERT INTO campaigns(owner_id,name,status,total_budget)
            VALUES($1,$2,$3,$4) RETURNING id`, [ownerId, `Performance ${index + 1}`, 'ACTIVE', 1000000000])).rows[0];
        campaigns.push(row.id);
    }
    const jobs = [];
    if (scenario === 'A' || scenario === 'B') {
        for (let index = 0; index < numberOfCampaigns; index++) {
            const preparations = Math.ceil((count - index) / numberOfCampaigns);
            await pool.query(`INSERT INTO executions(campaign_id,execution_no)
                SELECT $1,n FROM generate_series(1,$2::integer) n`, [campaigns[index], preparations]);
            if (legacy) await pool.query('UPDATE campaigns SET last_execution_no=$2 WHERE id=$1', [campaigns[index], preparations]);
        }
        if (sequence) await pool.query('SELECT setval($1::regclass,$2::bigint,true)', ['execution_no_seq', Math.ceil(count / numberOfCampaigns)]);
        for (let index = 0; index < count; index++) jobs.push({ campaignId: campaigns[index % numberOfCampaigns], requestId: String(Math.floor(index / numberOfCampaigns) + 1) });
    }
    return { campaigns, jobs, fixtureMs: performance.now() - start, sqlPreparedRows: jobs.length };
}
export async function validateWorkload(fixture, scenario, count) {
    const rows = (await fixture.pool.query(`SELECT c.id,c.spent_amount::text,
        COALESCE(SUM(e.approved_amount),0)::text AS ledger,
        COUNT(e.execution_no)::integer AS records,
        COUNT(*) FILTER(WHERE e.status=$1)::integer AS approved,
        COUNT(*) FILTER(WHERE e.status=$2)::integer AS prepared,
        COUNT(*) FILTER(WHERE e.status=$3)::integer AS rejected
        FROM campaigns c LEFT JOIN executions e ON e.campaign_id=c.id GROUP BY c.id ORDER BY c.id`, ['APPROVED', 'PREPARED', 'REJECTED'])).rows;
    for (const row of rows) assert.equal(row.spent_amount, row.ledger);
    const totals = rows.reduce((sum, row) => ({ spent: sum.spent + Number(row.spent_amount), records: sum.records + row.records,
        approved: sum.approved + row.approved, prepared: sum.prepared + row.prepared, rejected: sum.rejected + row.rejected }),
        { spent: 0, records: 0, approved: 0, prepared: 0, rejected: 0 });
    assert.deepEqual(totals, scenario === 'C' ? { spent: 0, records: count, approved: 0, prepared: count, rejected: 0 }
        : { spent: count, records: count, approved: count, prepared: 0, rejected: 0 });
    return { consistent: true, campaigns: rows.length, totals };
}
