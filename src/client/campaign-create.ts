import type { CampaignDto } from '../contracts/campaigns.js';
import type { PageContext } from './context.js';
import { amountInput, button, el, errorText, field, input, message } from './dom.js';

export function campaignCreate(context: PageContext): HTMLElement {
    const disclosure = el('details', '', 'campaign-create');
    const trigger = el('summary', '새 캠페인', 'button');
    const form = el('form', '', 'create-form');
    const name = input('text', 'name'), budget = amountInput('budget', 500000), feedback = el('p');
    name.maxLength = 100;
    const submit = button('만들기', () => {});
    submit.type = 'submit';
    const cancel = button('취소', () => { disclosure.open = false; trigger.focus(); }, 'button subtle');
    const actions = el('div', '', 'form-actions');
    actions.append(cancel, submit);
    form.append(el('h2', '새 캠페인'), field('캠페인 이름', name), field('예산 한도 (원)', budget), actions, feedback);
    disclosure.append(trigger, form);
    disclosure.addEventListener('toggle', () => { if (disclosure.open) name.focus(); });
    disclosure.addEventListener('keydown', event => {
        if (event.key === 'Escape') { disclosure.open = false; trigger.focus(); }
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        submit.disabled = true;
        try {
            const campaign = await context.api.request<CampaignDto>('POST', '/campaigns', { name: name.value, totalBudget: Number(budget.value) });
            if (!context.signal.aborted) location.hash = `#/campaigns/${campaign.id}`;
        } catch (error) {
            if (!context.signal.aborted) message(feedback, errorText(error), true);
        } finally {
            submit.disabled = false;
        }
    });
    return disclosure;
}
