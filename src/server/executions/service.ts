import type { Pool } from 'pg';
import { withTransaction } from '../db/transaction.js';
import { findOwnedCampaign, lockOwnedCampaign } from '../campaigns/repository.js';
import { ApiError } from '../http/errors.js';
import { decideExecution } from './decision.js';
import { debitCampaign, executionDto, findExecution, finishExecution, insertPreparation, listExecutions, lockExecution, nextExecutionNumber } from './repository.js';
export function createExecutionService(pool: Pool) {
    return {
        async prepare(ownerId: string, campaignId: string) {
            return withTransaction(pool, async (client) => {
                await lockOwnedCampaign(client, ownerId, campaignId);
                const number = await nextExecutionNumber(client, campaignId);
                return insertPreparation(client, campaignId, number);
            });
        },
        async get(ownerId: string, campaignId: string, number: string) {
            await findOwnedCampaign(pool, ownerId, campaignId);
            return findExecution(pool, campaignId, number);
        },
        async list(ownerId: string, campaignId: string, page: number, prepared: boolean) {
            await findOwnedCampaign(pool, ownerId, campaignId);
            return listExecutions(pool, campaignId, page, prepared);
        },
        async execute(ownerId: string, campaignId: string, number: string, amount: number) {
            return withTransaction(pool, async (client) => {
                const campaign = await lockOwnedCampaign(client, ownerId, campaignId);
                const execution = await lockExecution(client, campaignId, number);
                if (execution.status !== 'PREPARED') {
                    if (Number(execution.requested_amount) !== amount)
                        throw new ApiError(409, 'REQUEST_AMOUNT_CONFLICT', '같은 요청 번호에는 이전과 같은 금액을 사용해야 합니다.');
                    return executionDto(execution);
                }
                const decision = decideExecution({ status: campaign.status, totalBudget: Number(campaign.total_budget), spentAmount: Number(campaign.spent_amount) }, amount);
                if (decision.status === 'APPROVED')
                    await debitCampaign(client, campaignId, amount);
                return finishExecution(client, campaignId, number, amount, decision);
            });
        },
    };
}
export type ExecutionService = ReturnType<typeof createExecutionService>;
