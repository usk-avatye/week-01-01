import assert from 'node:assert/strict';
import type { CampaignDto } from '../../src/contracts/campaigns.js';
import type { ExecutionDto } from '../../src/contracts/executions.js';
import type { advertiser } from './advertiser.js';
type Advertiser = Awaited<ReturnType<typeof advertiser>>;
export async function setupCampaign(client: Advertiser, budget = 10000, active = true) {
    const created = await client.request<CampaignDto>('POST', '/api/campaigns', { name: 'Execution campaign', totalBudget: budget });
    assert.equal(created.status, 201);
    const path = `/api/campaigns/${created.body.id}`;
    if (active)
        assert.equal((await client.request('PATCH', path + '/status', { status: 'ACTIVE' })).status, 200);
    return { campaign: created.body, path };
}
export async function prepare(client: Advertiser, path: string): Promise<ExecutionDto> {
    const result = await client.request<ExecutionDto>('POST', path + '/preparations', {});
    assert.equal(result.status, 201);
    return result.body;
}
export const execute = (client: Advertiser, path: string, id: string, amount: number) => client.request<ExecutionDto>('POST', `${path}/executions/${id}`, { amount });
