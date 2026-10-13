import type { CampaignDto, Page } from '../contracts/campaigns.js';
import type { PageContext } from './context.js';
import { button, el, errorText, field, input, amountInput, link, message, money } from './dom.js';
import { pager } from './pager.js';
export async function campaignList(host: HTMLElement, context: PageContext, admin = false): Promise<void> {
    const list = el('section', '', 'card'), feedback = el('p');
    if (!admin)
        host.append(createCampaignForm(context));
    host.append(list, feedback);
    let revision = 0;
    async function load(page = 1): Promise<void> {
        const ticket = ++revision;
        try {
            const data = await context.api.request<Page<CampaignDto>>('GET', `${admin ? '/admin' : ''}/campaigns?page=${page}`);
            if (context.signal.aborted || ticket !== revision)
                return;
            const table = el('table'), head = el('tr');
            for (const label of ['캠페인', ...(admin ? ['광고주'] : []), '상태', '총예산', '누적 집행', '잔액'])
                head.append(el('th', label));
            const thead = el('thead');
            thead.append(head);
            table.append(thead);
            const body = el('tbody');
            for (const campaign of data.items) {
                const row = el('tr'), name = el('td');
                name.append(link(campaign.name, `#/${admin ? 'admin/' : ''}campaigns/${campaign.id}`));
                row.append(name);
                if (admin)
                    row.append(el('td', `${campaign.ownerName ?? ''} (${campaign.ownerEmail ?? ''})`));
                row.append(el('td', campaign.status === 'ACTIVE' ? '진행 중' : '일시정지'), el('td', money(campaign.totalBudget)), el('td', money(campaign.spentAmount)), el('td', money(campaign.remainingBudget)));
                body.append(row);
            }
            table.append(body);
            const scroll = el('div', '', 'table-scroll');
            scroll.append(table);
            list.replaceChildren(...(data.items.length ? [scroll] : [el('p', '캠페인이 없습니다.', 'muted')]), pager(page, data.hasNext, load));
            message(feedback, '');
        }
        catch (error) {
            if (!context.signal.aborted)
                message(feedback, errorText(error), true);
        }
    }
    await load();
}
function createCampaignForm(context: PageContext): HTMLElement {
    const form = el('form', '', 'card create-form'), name = input('text', 'name'), budget = amountInput('budget', 10000), feedback = el('p');
    name.maxLength = 100;
    const submit = button('캠페인 만들기', () => { });
    submit.type = 'submit';
    form.append(el('h2', '새 캠페인'), field('캠페인 이름', name), field('총예산 (원)', budget), submit, feedback);
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submit.disabled = true;
        try {
            const campaign = await context.api.request<CampaignDto>('POST', '/campaigns', { name: name.value, totalBudget: Number(budget.value) });
            if (!context.signal.aborted)
                location.hash = `#/campaigns/${campaign.id}`;
        }
        catch (error) {
            message(feedback, errorText(error), true);
        }
        finally {
            submit.disabled = false;
        }
    });
    return form;
}
