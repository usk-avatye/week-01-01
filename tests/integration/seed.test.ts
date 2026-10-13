import assert from 'node:assert/strict';
import test from 'node:test';
import { seedDemo } from '../../src/server/db/seed-demo.js';
import { createFixture } from '../support/database.js';
import { createExecutionService } from '../../src/server/executions/service.js';
import { verifyPassword } from '../../src/server/auth/password.js';
test('demo seed is repeatable without resetting roles, spend or request counters', async (t) => {
    const f = await createFixture();
    t.after(() => f.close());
    await seedDemo(f.pool, 'Demo-Campaign-2026!');
    const members = await f.pool.query('SELECT * FROM members ORDER BY email');
    assert.equal(members.rowCount, 3);
    assert.equal(members.rows.filter(m => m.role === 'ADMIN').length, 1);
    assert.equal(await verifyPassword('Demo-Campaign-2026!', members.rows[0].password_hash), true);
    const campaign = (await f.pool.query('SELECT * FROM campaigns ORDER BY id LIMIT 1')).rows[0];
    await f.pool.query("UPDATE campaigns SET status='ACTIVE' WHERE id=$1", [campaign.id]);
    const executions = createExecutionService(f.pool), prepared = await executions.prepare(campaign.owner_id, campaign.id);
    await executions.execute(campaign.owner_id, campaign.id, prepared.requestId, 1000);
    await seedDemo(f.pool, 'Demo-Campaign-2026!');
    assert.equal((await f.pool.query('SELECT id FROM members')).rowCount, 3);
    assert.equal((await f.pool.query('SELECT id FROM campaigns')).rowCount, 9);
    const retained = (await f.pool.query('SELECT * FROM campaigns WHERE id=$1', [campaign.id])).rows[0];
    assert.equal(retained.spent_amount, '1000');
    assert.equal(retained.last_execution_no, '0');
    assert.equal(retained.status, 'ACTIVE');
});

test('seed upgrades old display names without creating duplicate campaigns or resetting executions', async t => {
    const f = await createFixture(); t.after(() => f.close());
    await seedDemo(f.pool, 'Demo-Campaign-2026!');
    const campaign = (await f.pool.query(`SELECT c.* FROM campaigns c JOIN members m ON m.id=c.owner_id WHERE m.email='advertiser-a@example.test' AND c.name='신제품 런칭'`)).rows[0];
    const oldName = `신제품 런칭 ${String.fromCodePoint(0x00B7)} 예산 보호`;
    await f.pool.query("UPDATE campaigns SET name=$2,status='ACTIVE' WHERE id=$1", [campaign.id, oldName]);
    await f.pool.query('UPDATE members SET display_name=$2 WHERE id=$1', [campaign.owner_id, `광고주 ${String.fromCodePoint(0x00B7)} A`]);
    const executions = createExecutionService(f.pool), prepared = await executions.prepare(campaign.owner_id, campaign.id);
    const approved = await executions.execute(campaign.owner_id, campaign.id, prepared.requestId, 1000);
    await seedDemo(f.pool, 'Demo-Campaign-2026!');
    await seedDemo(f.pool, 'Demo-Campaign-2026!');
    const retained = (await f.pool.query('SELECT * FROM campaigns WHERE id=$1', [campaign.id])).rows[0];
    assert.equal(retained.name, '신제품 런칭');
    assert.equal(retained.spent_amount, '1000'); assert.equal(retained.last_execution_no, '0'); assert.equal(retained.status, 'ACTIVE');
    assert.equal((await f.pool.query('SELECT id FROM campaigns')).rowCount, 9);
    assert.equal((await f.pool.query('SELECT display_name FROM members WHERE id=$1', [campaign.owner_id])).rows[0].display_name, '모노픽셀');
    const replay = await executions.execute(campaign.owner_id, campaign.id, prepared.requestId, 1000);
    assert.deepEqual(replay, approved);
});

test('realistic demo spend has matching immutable execution records and survives reseeding', async t => {
    const f = await createFixture(); t.after(() => f.close());
    await seedDemo(f.pool, 'Demo-Campaign-2026!');
    const campaign = (await f.pool.query("SELECT * FROM campaigns WHERE name='10월 가을 신상품 전환'")).rows[0];
    assert.ok(campaign, 'A realistic campaign is seeded');
    assert.equal(campaign.total_budget, '2400000');
    assert.equal(campaign.spent_amount, '1686000');
    const mismatches = await f.pool.query(`SELECT c.id FROM campaigns c LEFT JOIN executions e ON e.campaign_id=c.id
        GROUP BY c.id HAVING c.spent_amount <> COALESCE(SUM(e.approved_amount),0)`);
    assert.equal(mismatches.rowCount, 0, 'Demo balances agree with their execution ledger');
    const rejected = (await f.pool.query(`SELECT e.* FROM executions e JOIN campaigns c ON c.id=e.campaign_id
        WHERE c.name='신규 회원 첫 구매' AND e.status='REJECTED'`)).rows[0];
    assert.equal(rejected.rejection_reason, 'INSUFFICIENT_BUDGET');
    assert.equal(rejected.approved_amount, '0');
    const paused = (await f.pool.query(`SELECT e.* FROM executions e JOIN campaigns c ON c.id=e.campaign_id
        WHERE c.name='소파 신제품 사전 예약'`)).rows[0];
    assert.equal(paused.rejection_reason, 'CAMPAIGN_PAUSED');
    const service = createExecutionService(f.pool);
    const first = (await f.pool.query('SELECT execution_no FROM executions WHERE campaign_id=$1 ORDER BY execution_no LIMIT 1', [campaign.id])).rows[0];
    const original = await service.get(campaign.owner_id, campaign.id, first.execution_no);
    assert.deepEqual(await service.execute(campaign.owner_id, campaign.id, first.execution_no, 250000), original);
    await f.pool.query("UPDATE campaigns SET status='PAUSED',total_budget=3000000 WHERE id=$1", [campaign.id]);
    const before = (await f.pool.query('SELECT * FROM executions ORDER BY campaign_id,execution_no')).rows;
    await seedDemo(f.pool, 'Demo-Campaign-2026!');
    assert.deepEqual((await f.pool.query('SELECT * FROM executions ORDER BY campaign_id,execution_no')).rows, before);
    const retained = (await f.pool.query('SELECT * FROM campaigns WHERE id=$1', [campaign.id])).rows[0];
    assert.equal(retained.total_budget, '3000000');
    assert.equal(retained.status, 'PAUSED');
    assert.equal(retained.spent_amount, '1686000');
});
