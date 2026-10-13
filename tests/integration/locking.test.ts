import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { setTimeout } from 'node:timers/promises';
import type { ExecutionDto } from '../../src/contracts/executions.js';
import { createHttpFixture } from '../support/http.js';
import { advertiser } from '../support/advertiser.js';
import { prepare, setupCampaign } from '../support/campaign.js';
async function waitBlocked(pool: Pool, schema: string, count: number) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
        const result = await pool.query(`SELECT count(*) AS count FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'`, [schema]);
        if (Number(result.rows[0].count) >= count)
            return;
        await setTimeout(10);
    }
    throw new Error(`Did not observe ${count} blocked database requests`);
}
for (const first of ['pause', 'spend'] as const) {
    test(`${first} queued first determines the state used by the concurrent spend`, async (t) => {
        const f = await createHttpFixture();
        t.after(() => f.close());
        const a = await advertiser(f);
        const { campaign, path } = await setupCampaign(a);
        const record = await prepare(a, path);
        const blocker = await f.pool.connect();
        try {
            await blocker.query('BEGIN');
            await blocker.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE', [campaign.id]);
            const pause = () => a.request('PATCH', path + '/status', { status: 'PAUSED' });
            const spend = () => a.request<ExecutionDto>('POST', `${path}/executions/${record.requestId}`, { amount: 1000 });
            const earlier = first === 'pause' ? pause() : spend();
            await waitBlocked(f.pool, f.schema, 1);
            const later = first === 'pause' ? spend() : pause();
            await waitBlocked(f.pool, f.schema, 2);
            await blocker.query('COMMIT');
            await Promise.all([earlier, later]);
            const result = await a.request<ExecutionDto>('GET', `${path}/executions/${record.requestId}`);
            assert.equal(result.body.status, first === 'pause' ? 'REJECTED' : 'APPROVED');
            assert.equal(result.body.approvedAmount, first === 'pause' ? 0 : 1000);
            if (first === 'pause')
                assert.equal(result.body.rejectionReason, 'CAMPAIGN_PAUSED');
        }
        finally {
            await blocker.query('ROLLBACK');
            blocker.release();
        }
    });
}
