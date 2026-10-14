import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { withTransaction } from '../src/server/db/transaction.js';
import { insertCampaign, updateStatus } from '../src/server/campaigns/repository.js';

export async function prepareRecoveryDemo(pool: Pool, origin: string) {
    const email = 'advertiser-a@example.test';
    const stamp = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium' }).format(new Date());
    const run = `${stamp} ${randomUUID().slice(0, 8)}`;
    return withTransaction(pool, async db => {
        const owner = (await db.query<{ id: string; role: string }>('SELECT id,role FROM members WHERE email=$1', [email])).rows[0];
        if (!owner || owner.role !== 'ADVERTISER') throw new Error('모노픽셀 시연 계정이 필요합니다. npm run db:seed를 먼저 실행하세요.');
        const scenarios = [];
        for (const [action, title] of [['confirm', '결과 확인'], ['retry', '다시 시도']] as const) {
            const campaign = await insertCampaign(db, owner.id, `미확정 복구: ${title} (${run})`, 10000);
            await updateStatus(db, campaign.id, 'ACTIVE');
            scenarios.push({ action, campaignId: campaign.id, name: campaign.name, url: `${origin}/#/campaigns/${campaign.id}` });
        }
        return { email, origin, scenarios };
    });
}
