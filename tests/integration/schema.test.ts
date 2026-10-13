import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixture } from '../support/database.js';
test('database prevents overspending even if application validation is bypassed', async (t) => {
    const fixture = await createFixture();
    t.after(() => fixture.close());
    const { rows: [member] } = await fixture.pool.query(`INSERT INTO members(email,password_hash,display_name,role) VALUES ('schema@example.test','hash','Schema','ADVERTISER') RETURNING id`);
    await assert.rejects(fixture.pool.query(`INSERT INTO campaigns(owner_id,name,total_budget,spent_amount) VALUES ($1,'Invalid',1000,1001)`, [member.id]), { code: '23514' });
});
test('database rejects duplicate execution identity and inconsistent approved rows', async (t) => {
    const fixture = await createFixture();
    t.after(() => fixture.close());
    const { rows: [member] } = await fixture.pool.query(`INSERT INTO members(email,password_hash,display_name,role) VALUES ('schema@example.test','hash','Schema','ADVERTISER') RETURNING id`);
    const { rows: [campaign] } = await fixture.pool.query(`INSERT INTO campaigns(owner_id,name,total_budget) VALUES ($1,'Campaign',1000) RETURNING id`, [member.id]);
    await fixture.pool.query('INSERT INTO executions(campaign_id,execution_no) VALUES ($1,1)', [campaign.id]);
    await assert.rejects(fixture.pool.query('INSERT INTO executions(campaign_id,execution_no) VALUES ($1,1)', [campaign.id]), { code: '23505' });
    await assert.rejects(fixture.pool.query(`UPDATE executions SET status='APPROVED' WHERE campaign_id=$1 AND execution_no=1`, [campaign.id]), { code: '23514' });
});
