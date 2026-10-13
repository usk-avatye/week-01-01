import type { CampaignDto, Page } from '../contracts/campaigns.js';
import type { PageContext } from './context.js';
import { el, errorText, message } from './dom.js';
import { campaignCreate } from './campaign-create.js';
import { campaignTable } from './campaign-table.js';
import { pager } from './pager.js';

export async function campaignList(host: HTMLElement, context: PageContext, admin = false): Promise<void> {
    const toolbar = el('div', '', 'list-toolbar'), count = el('span', '', 'muted');
    toolbar.append(count);
    if (!admin) toolbar.append(campaignCreate(context));
    const list = el('section', '', 'data-section'), feedback = el('p');
    host.append(toolbar, list, feedback);
    let revision = 0;
    async function load(page = 1): Promise<void> {
        const ticket = ++revision;
        try {
            const data = await context.api.request<Page<CampaignDto>>('GET', `${admin ? '/admin' : ''}/campaigns?page=${page}`);
            if (context.signal.aborted || ticket !== revision) return;
            count.textContent = `${data.items.length}개 표시`;
            list.replaceChildren(data.items.length ? campaignTable(data.items, admin) : el('p', '캠페인이 없습니다.', 'empty-state'), pager(page, data.hasNext, load));
            message(feedback, '');
        } catch (error) {
            if (!context.signal.aborted) message(feedback, errorText(error), true);
        }
    }
    await load();
}
