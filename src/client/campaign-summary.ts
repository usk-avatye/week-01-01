import type { CampaignDto } from '../contracts/campaigns.js';
import { el, money } from './dom.js';
import { budgetUsage } from './budget-usage.js';
export function campaignSummary(campaign: CampaignDto): HTMLElement {
    const summary = el('section', '', 'budget-summary');
    for (const [label, amount] of [['예산 한도', campaign.totalBudget], ['누적 집행', campaign.spentAmount], ['집행 가능액', campaign.remainingBudget]] as const) {
        const card = el('div', '', 'metric');
        card.append(el('span', label, 'muted'), el('strong', money(amount)));
        summary.append(card);
    }
    const usage = el('div', '', 'metric usage-metric');
    usage.append(el('span', '예산 사용률', 'muted'), budgetUsage(campaign.spentAmount, campaign.totalBudget));
    summary.append(usage);
    const meta = el('div', '', 'campaign-meta');
    meta.append(el('span', campaign.status === 'ACTIVE' ? '진행 중' : '일시정지', `badge ${campaign.status.toLowerCase()}`), el('span', `캠페인 #${campaign.id}`));
    if (campaign.ownerName)
        meta.append(el('span', `${campaign.ownerName} (${campaign.ownerEmail})`));
    const wrapper = el('div');
    wrapper.append(meta, summary);
    return wrapper;
}
