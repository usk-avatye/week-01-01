import type { CampaignDto } from '../contracts/campaigns.js';
import type { PageContext } from './context.js';
import { el, link } from './dom.js';
import { campaignSummary } from './campaign-summary.js';
import { campaignControls } from './campaign-controls.js';
import { executionController } from './execution-controller.js';
import { renderExecutionPanel } from './execution-panel.js';
import { executionHistory } from './execution-history.js';
export async function campaignDetail(host: HTMLElement, context: PageContext, campaignId: string, admin = false): Promise<void> {
    const path = `${admin ? '/admin' : ''}/campaigns/${campaignId}`;
    const campaign = await context.api.request<CampaignDto>('GET', path);
    if (context.signal.aborted)
        return;
    const title = el('h1', campaign.name, 'campaign-title'), summary = el('div'), controls = el('div'), panel = el('div'), records = el('div');
    host.append(link('← 캠페인 목록', `#/${admin ? 'admin/' : ''}campaigns`, 'back-link'), title, summary);
    if (!admin) {
        const work = el('div', '', 'work-grid');
        work.append(controls, panel);
        host.append(work);
    }
    host.append(records);
    function display(value: CampaignDto): void {
        if (context.signal.aborted) return;
        summary.replaceChildren(campaignSummary(value));
        if (!admin) controls.replaceChildren(campaignControls(value, context, display));
    }
    display(campaign);
    const controller = admin ? undefined : executionController(context, campaignId, localStorage, () => renderExecutionPanel(panel, controller!), async () => {
        const latest = await context.api.request<CampaignDto>('GET', path);
        display(latest);
        await history.refresh();
    });
    const history = executionHistory(records, context, campaignId, admin, controller?.adopt);
    if (controller)
        renderExecutionPanel(panel, controller);
    await history.refresh();
}
