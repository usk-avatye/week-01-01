import type { CampaignDto } from '../contracts/campaigns.js';
import type { PageContext } from './context.js';
import { amountInput, button, el, errorText, field, message, money } from './dom.js';
export function campaignControls(campaign: CampaignDto, context: PageContext, updated: (campaign: CampaignDto) => void): HTMLElement {
    const card = el('section', '', 'card'), feedback = el('p');
    const heading = el('div', '', 'section-heading');
    heading.append(el('h2', '예산 설정'));
    const toggle = button(campaign.status === 'ACTIVE' ? '일시정지' : '캠페인 시작', async () => {
        toggle.disabled = true;
        try {
            const result = await context.api.request<CampaignDto>('PATCH', `/campaigns/${campaign.id}/status`, { status: campaign.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' });
            updated(result);
        }
        catch (error) {
            message(feedback, errorText(error), true);
            toggle.disabled = false;
        }
    }, 'button subtle small');
    heading.append(toggle);
    const form = el('form', '', 'inline-form'), budget = amountInput('totalBudget', campaign.totalBudget), save = button('예산 저장', () => { });
    save.type = 'submit';
    budget.disabled = campaign.status === 'ACTIVE';
    budget.min = String(Math.max(1, campaign.spentAmount));
    save.disabled = campaign.status === 'ACTIVE';
    form.append(field('예산 한도 (원)', budget), save);
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        save.disabled = true;
        try {
            const result = await context.api.request<CampaignDto>('PATCH', `/campaigns/${campaign.id}/budget`, { totalBudget: Number(budget.value) });
            updated(result);
        }
        catch (error) {
            message(feedback, errorText(error), true);
            save.disabled = false;
        }
    });
    card.append(heading, form);
    if (campaign.status === 'ACTIVE') card.append(el('p', '예산 수정은 일시정지 후 가능합니다.', 'muted'));
    else if (campaign.spentAmount > 0) card.append(el('p', `최소 예산 ${money(campaign.spentAmount)}`, 'muted'));
    card.append(feedback);
    return card;
}
