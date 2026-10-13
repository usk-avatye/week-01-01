import type { CampaignStatus } from '../../contracts/campaigns.js';
import { lockOwnedCampaign, updateStatus } from '../campaigns/repository.js';
import { decideExecution } from '../executions/decision.js';
import { debitCampaign, finishExecution, insertPreparation } from '../executions/repository.js';
import type { Queryable } from './pool.js';

interface DemoCampaign {
    name: string;
    budget: number;
    status: CampaignStatus;
    amounts: readonly number[];
    rejectedAmount?: number;
}

export const demoCampaigns = {
    'advertiser-a@example.test': [
        { name: '신제품 런칭', budget: 10000, status: 'PAUSED', amounts: [] },
        { name: '브랜드 검색 상시 운영', budget: 620000, status: 'ACTIVE', amounts: [196000, 196000, 196000], rejectedAmount: 40000 },
        { name: '신규 회원 첫 구매', budget: 500000, status: 'ACTIVE', amounts: [120000, 180000, 200000], rejectedAmount: 1000 },
        { name: '장바구니 이탈 리타겟팅', budget: 900000, status: 'PAUSED', amounts: [150000, 200000, 100000], rejectedAmount: 50000 },
        { name: '10월 가을 신상품 전환', budget: 2400000, status: 'ACTIVE', amounts: [250000, 320000, 280000, 310000, 286000, 240000] },
    ],
    'advertiser-b@example.test': [
        { name: '브랜드 인지도', budget: 10000, status: 'PAUSED', amounts: [] },
        { name: '가을 홈스타일링 기획전', budget: 1500000, status: 'ACTIVE', amounts: [150000, 220000, 260000] },
        { name: '소파 신제품 사전 예약', budget: 800000, status: 'PAUSED', amounts: [], rejectedAmount: 20000 },
        { name: '신규 고객 첫 방문', budget: 1000000, status: 'ACTIVE', amounts: [240000, 240000, 240000] },
    ],
} as const satisfies Record<string, readonly DemoCampaign[]>;

export async function seedCampaigns(db: Queryable, ownerId: string, campaigns: readonly DemoCampaign[]): Promise<void> {
    for (const campaign of campaigns) {
        const row = (await db.query<{ id: string }>(`INSERT INTO campaigns(owner_id,name,total_budget)
            SELECT $1,$2,$3 WHERE NOT EXISTS(SELECT 1 FROM campaigns WHERE owner_id=$1 AND name=$2)
            RETURNING id`, [ownerId, campaign.name, campaign.budget])).rows[0];
        if (!row) continue;
        if (campaign.amounts.length) await updateStatus(db, row.id, 'ACTIVE');
        for (const amount of campaign.amounts) await recordExecution(db, ownerId, row.id, amount);
        await updateStatus(db, row.id, campaign.status);
        if (campaign.rejectedAmount !== undefined) await recordExecution(db, ownerId, row.id, campaign.rejectedAmount);
    }
}

async function recordExecution(db: Queryable, ownerId: string, campaignId: string, amount: number): Promise<void> {
    const campaign = await lockOwnedCampaign(db, ownerId, campaignId);
    const preparation = await insertPreparation(db, campaignId);
    const decision = decideExecution({ status: campaign.status, totalBudget: Number(campaign.total_budget), spentAmount: Number(campaign.spent_amount) }, amount);
    if (decision.status === 'APPROVED') await debitCampaign(db, campaignId, amount);
    await finishExecution(db, campaignId, preparation.requestId, amount, decision);
}
