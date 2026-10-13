import type { CampaignStatus } from '../../contracts/campaigns.js';
import type { ExecutionDecision } from '../../contracts/executions.js';
export interface BudgetState {
    status: CampaignStatus;
    totalBudget: number;
    spentAmount: number;
}
export function decideExecution(campaign: BudgetState, amount: number): ExecutionDecision {
    if (campaign.status === 'PAUSED') {
        return { status: 'REJECTED', approvedAmount: 0, rejectionReason: 'CAMPAIGN_PAUSED' };
    }
    if (amount > campaign.totalBudget - campaign.spentAmount) {
        return { status: 'REJECTED', approvedAmount: 0, rejectionReason: 'INSUFFICIENT_BUDGET' };
    }
    return { status: 'APPROVED', approvedAmount: amount, rejectionReason: null };
}
