import type { CampaignDto } from '../contracts/campaigns.js';
import { budgetUsage } from './budget-usage.js';
import { el, link, money } from './dom.js';

export function campaignTable(campaigns: CampaignDto[], admin: boolean): HTMLElement {
    const table = el('table', '', 'campaign-table'), head = el('tr');
    const headers = ['캠페인', ...(admin ? ['광고주'] : []), '상태', '예산 한도', '누적 집행', '집행 가능액', '사용률'];
    for (const [index, label] of headers.entries()) {
        const cell = el('th', label, index >= (admin ? 3 : 2) ? 'numeric' : '');
        cell.scope = 'col';
        head.append(cell);
    }
    const thead = el('thead'), body = el('tbody');
    thead.append(head);
    for (const campaign of campaigns) {
        const row = el('tr'), name = el('td', '', 'campaign-name');
        name.append(link(campaign.name, `#/${admin ? 'admin/' : ''}campaigns/${campaign.id}`), el('span', `#${campaign.id}`, 'row-id'));
        row.append(name);
        if (admin) {
            const owner = el('td');
            owner.append(el('span', campaign.ownerName ?? ''), el('span', campaign.ownerEmail ?? '', 'row-id'));
            row.append(owner);
        }
        const status = el('td');
        status.append(el('span', campaign.status === 'ACTIVE' ? '진행 중' : '일시정지', `badge ${campaign.status.toLowerCase()}`));
        row.append(status, el('td', money(campaign.totalBudget), 'numeric'), el('td', money(campaign.spentAmount), 'numeric'), el('td', money(campaign.remainingBudget), 'numeric'));
        const usage = el('td');
        usage.append(budgetUsage(campaign.spentAmount, campaign.totalBudget));
        row.append(usage);
        body.append(row);
    }
    const footer = el('tfoot'), totals = el('tr'), label = el('th', '페이지 합계');
    label.colSpan = admin ? 3 : 2;
    label.scope = 'row';
    totals.append(label);
    for (const key of ['totalBudget', 'spentAmount', 'remainingBudget'] as const)
        totals.append(el('td', money(campaigns.reduce((sum, campaign) => sum + campaign[key], 0)), 'numeric'));
    totals.append(el('td'));
    footer.append(totals);
    table.append(thead, body, footer);
    const scroll = el('div', '', 'table-scroll');
    scroll.append(table);
    return scroll;
}
