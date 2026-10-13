import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { createFixture } from '../support/database.js';
import { createExecutionService } from '../../src/server/executions/service.js';
import { migrate } from '../../src/server/db/migrate.js';

async function campaigns(pool: Awaited<ReturnType<typeof createFixture>>['pool']) {
    const member = (await pool.query(`INSERT INTO members(email,password_hash,display_name,role)
        VALUES ('sequence@example.test','test','Sequence','ADVERTISER') RETURNING id`)).rows[0];
    const rows = (await pool.query(`INSERT INTO campaigns(owner_id,name,total_budget,status)
        VALUES ($1,'First',10000,'ACTIVE'),($1,'Second',10000,'ACTIVE') RETURNING id`, [member.id])).rows;
    return { owner: member.id as string, ids: rows.map(row => row.id as string) };
}

test('database sequence issues distinct IDs across campaigns and sixty concurrent preparations', async t => {
    const f = await createFixture(); t.after(() => f.close());
    const { owner, ids } = await campaigns(f.pool);
    const service = createExecutionService(f.pool);
    const records = await Promise.all(Array.from({ length: 60 }, (_, i) => service.prepare(owner, ids[i % 2]!)));
    assert.equal(new Set(records.map(row => row.requestId)).size, 60);
    assert.equal((await f.pool.query('SELECT SUM(spent_amount) AS amount FROM campaigns')).rows[0].amount, '0');
});

test('preparation completes while a campaign budget writer holds NO KEY UPDATE', async t => {
    const f = await createFixture(); t.after(() => f.close());
    const { owner, ids } = await campaigns(f.pool), blocker = await f.pool.connect();
    let operation: ReturnType<ReturnType<typeof createExecutionService>['prepare']> | undefined;
    try {
        await blocker.query('BEGIN');
        await blocker.query('SELECT id FROM campaigns WHERE id=$1 FOR NO KEY UPDATE', [ids[0]]);
        operation = createExecutionService(f.pool).prepare(owner, ids[0]!);
        const completed = await Promise.race([operation.then(() => true), setTimeout(800).then(() => false)]);
        assert.equal(completed, true, 'Preparation should coexist with a non-key budget lock');
    } finally { await blocker.query('ROLLBACK'); blocker.release(); await operation; }
});

test('failed preparation leaves no record or debit and consumes only a sequence gap', async t => {
    const f = await createFixture(); t.after(() => f.close());
    const { owner, ids } = await campaigns(f.pool), service = createExecutionService(f.pool);
    const first = await service.prepare(owner, ids[0]!);
    await f.pool.query(`CREATE FUNCTION fail_preparation() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'test preparation write failure'; END $$;
        CREATE TRIGGER fail_preparation BEFORE INSERT ON executions FOR EACH ROW EXECUTE FUNCTION fail_preparation()`);
    await assert.rejects(service.prepare(owner, ids[0]!));
    await f.pool.query('DROP TRIGGER fail_preparation ON executions');
    const next = await service.prepare(owner, ids[0]!);
    assert.equal(BigInt(next.requestId), BigInt(first.requestId) + 2n);
    assert.equal((await f.pool.query('SELECT count(*) AS count FROM executions')).rows[0].count, '2');
    assert.equal((await f.pool.query('SELECT SUM(spent_amount) AS amount FROM campaigns')).rows[0].amount, '0');
});

test('sequence migration preserves old results and starts above recorded IDs and legacy counters', async t => {
    const f = await createFixture(); t.after(() => f.close());
    const { owner, ids } = await campaigns(f.pool);
    await f.pool.query('ALTER TABLE executions ALTER COLUMN execution_no DROP DEFAULT');
    await f.pool.query('DROP SEQUENCE IF EXISTS execution_no_seq');
    await f.pool.query("DELETE FROM schema_migrations WHERE name='002_execution_sequence.sql'");
    await f.pool.query('UPDATE campaigns SET last_execution_no=100,spent_amount=1000 WHERE id=$1', [ids[0]]);
    await f.pool.query(`INSERT INTO executions(campaign_id,execution_no,status,requested_amount,approved_amount,processed_at)
        VALUES ($1,7,'APPROVED',1000,1000,clock_timestamp()),($2,7,'APPROVED',1000,1000,clock_timestamp())`, ids);
    await f.pool.query('UPDATE campaigns SET spent_amount=1000 WHERE id=$1', [ids[1]]);
    const oldCampaigns = (await f.pool.query('SELECT * FROM campaigns ORDER BY id')).rows;
    const oldExecutions = (await f.pool.query('SELECT * FROM executions ORDER BY campaign_id')).rows;
    assert.ok(await readFile('db/migrations/002_execution_sequence.sql'));
    await migrate(f.pool); await migrate(f.pool);
    assert.deepEqual((await f.pool.query('SELECT * FROM campaigns ORDER BY id')).rows, oldCampaigns);
    assert.deepEqual((await f.pool.query('SELECT * FROM executions ORDER BY campaign_id')).rows, oldExecutions);
    const service = createExecutionService(f.pool);
    assert.equal((await service.prepare(owner, ids[0]!)).requestId, '101');
    assert.equal((await service.prepare(owner, ids[1]!)).requestId, '102');
    assert.equal((await service.execute(owner, ids[0]!, '7', 1000)).approvedAmount, 1000);
    assert.equal((await f.pool.query('SELECT spent_amount FROM campaigns WHERE id=$1', [ids[0]])).rows[0].spent_amount, '1000');
});

test('foreign key insertion waits for UPDATE and coexists with NO KEY UPDATE', async t => {
    const f = await createFixture(); t.after(() => f.close());
    const { ids } = await campaigns(f.pool), blocker = await f.pool.connect(), writer = await f.pool.connect();
    try {
        await writer.query("SET statement_timeout='300ms'");
        await blocker.query('BEGIN');
        await blocker.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE', [ids[0]]);
        await assert.rejects(writer.query('INSERT INTO executions(campaign_id,execution_no) VALUES ($1,500)', [ids[0]]), { code: '57014' });
        await blocker.query('ROLLBACK'); await blocker.query('BEGIN');
        await blocker.query('SELECT id FROM campaigns WHERE id=$1 FOR NO KEY UPDATE', [ids[0]]);
        assert.equal((await writer.query('INSERT INTO executions(campaign_id,execution_no) VALUES ($1,501)', [ids[0]])).rowCount, 1);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); writer.release(); }
});
