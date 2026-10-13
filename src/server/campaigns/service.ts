import type { Pool } from 'pg';
import { withTransaction } from '../db/transaction.js';
import { ApiError } from '../http/errors.js';
import { bodyFields, parseAmount, parseName } from '../http/input.js';
import { campaignDto, findOwnedCampaign, insertCampaign, listOwnedCampaigns, lockOwnedCampaign, updateBudget, updateStatus } from './repository.js';
export function createCampaignService(pool: Pool) {
    return {
        async create(ownerId: string, input: unknown) {
            const fields = bodyFields(input, ['name', 'totalBudget']);
            return insertCampaign(pool, ownerId, parseName(fields.name), parseAmount(fields.totalBudget));
        },
        async list(ownerId: string, page: number) { return listOwnedCampaigns(pool, ownerId, page); },
        async get(ownerId: string, id: string) { return campaignDto(await findOwnedCampaign(pool, ownerId, id)); },
        async changeBudget(ownerId: string, id: string, input: unknown) {
            const fields = bodyFields(input, ['totalBudget']), budget = parseAmount(fields.totalBudget);
            return withTransaction(pool, async (client) => {
                const campaign = await lockOwnedCampaign(client, ownerId, id);
                if (campaign.status !== 'PAUSED')
                    throw new ApiError(409, 'PAUSE_REQUIRED', '예산 수정 전에 캠페인을 일시정지해 주세요.');
                if (budget < Number(campaign.spent_amount))
                    throw new ApiError(409, 'BUDGET_BELOW_SPENT', '이미 사용한 금액보다 예산을 줄일 수 없습니다.');
                return updateBudget(client, id, budget);
            });
        },
        async changeStatus(ownerId: string, id: string, input: unknown) {
            const fields = bodyFields(input, ['status']), status = fields.status;
            if (status !== 'ACTIVE' && status !== 'PAUSED')
                throw new ApiError(400, 'INVALID_STATUS', '캠페인 상태를 확인해 주세요.');
            return withTransaction(pool, async (client) => {
                await lockOwnedCampaign(client, ownerId, id);
                return updateStatus(client, id, status);
            });
        },
    };
}
export type CampaignService = ReturnType<typeof createCampaignService>;
