import type { CampaignDto } from '../contracts/campaigns.js';
import { el, money } from './dom.js';
export function campaignSummary(campaign: CampaignDto): HTMLElement {
    const summary = el('section', '', 'budget-summary');
    for (const [label, amount] of [['총예산', campaign.totalBudget], ['누적 집행', campaign.spentAmount], ['잔액', campaign.remainingBudget]] as const) {
        const card = el('div', '', 'metric');
        card.append(el('span', label, 'muted'), el('strong', money(amount)));
        summary.append(card);
    }
    const meta = el('div', '', 'campaign-meta');
    meta.append(el('span', campaign.status === 'ACTIVE' ? '진행 중' : '일시정지', `badge ${campaign.status.toLowerCase()}`), el('span', `캠페인 #${campaign.id}`));
    if (campaign.ownerName)
        meta.append(el('span', `${campaign.ownerName} (${campaign.ownerEmail})`));
    const wrapper = el('div');
    wrapper.append(meta, summary);
    return wrapper;
}
