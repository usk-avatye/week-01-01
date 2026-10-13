import type { ExecutionDto } from '../contracts/executions.js';
import type { Page } from '../contracts/campaigns.js';
import type { PageContext } from './context.js';
import { button, el, errorText, message, money, time } from './dom.js';
import { executionReceipt, reasonText, statusText } from './execution-receipt.js';
import { pager } from './pager.js';
export function executionHistory(host: HTMLElement, context: PageContext, campaignId: string, admin = false, adopt?: (id: string) => Promise<void>) {
    const prefix = `${admin ? '/admin' : ''}/campaigns/${campaignId}`, history = el('section', '', 'card'), preparations = el('section', '', 'card');
    host.append(history);
    if (!admin)
        host.append(preparations);
    let historyPage = 1, preparationPage = 1;
    const revisions = { history: 0, preparations: 0 };
    async function load(page: number, prepared: boolean): Promise<void> {
        const node = prepared ? preparations : history, path = prepared ? '/preparations' : '/executions';
        const key = prepared ? 'preparations' : 'history', ticket = ++revisions[key];
        try {
            const data = await context.api.request<Page<ExecutionDto>>('GET', `${prefix}${path}?page=${page}`);
            if (context.signal.aborted || ticket !== revisions[key])
                return;
            if (prepared)
                preparationPage = page;
            else
                historyPage = page;
            const table = el('table'), head = el('tr');
            for (const title of [...(prepared ? ['번호', '준비 시각'] : ['번호', '상태', '요청 금액', '차감액', '사유', '처리 시각']), ...(admin ? [] : ['동작'])])
                head.append(el('th', title));
            const thead = el('thead');
            thead.append(head);
            table.append(thead);
            const body = el('tbody'), notice = el('p');
            for (const result of data.items) {
                const row = el('tr');
                row.append(el('td', '#' + result.requestId));
                if (prepared) row.append(el('td', time(result.createdAt)));
                else row.append(el('td', statusText(result)), el('td', money(result.requestedAmount!)), el('td', money(result.approvedAmount)), el('td', reasonText(result)), el('td', time(result.processedAt)));
                if (!admin) {
                    const action = el('td'), replay = button(prepared ? '번호 선택' : '동일 요청 재전송', async () => {
                        replay.disabled = true;
                        try {
                            if (prepared)
                                await adopt?.(result.requestId);
                            else {
                                const receipt = await context.api.request<ExecutionDto>('POST', `${prefix}/executions/${result.requestId}`, { amount: result.requestedAmount });
                                notice.replaceChildren(executionReceipt(receipt));
                            }
                        }
                        catch (error) {
                            message(notice, errorText(error), true);
                        }
                        finally {
                            replay.disabled = false;
                        }
                    }, 'button subtle small');
                    action.append(replay);
                    row.append(action);
                }
                body.append(row);
            }
            table.append(body);
            const scroll = el('div', '', 'table-scroll');
            scroll.append(table);
            node.replaceChildren(el('h2', prepared ? '미사용 준비 번호' : '집행 이력'), ...(data.items.length ? [scroll] : [el('p', '기록이 없습니다.', 'muted')]), pager(page, data.hasNext, p => load(p, prepared)), notice);
        }
        catch (error) {
            if (!context.signal.aborted)
                message(node, errorText(error), true);
        }
    }
    return {
        async refresh() { await Promise.all([load(historyPage, false), ...(!admin ? [load(preparationPage, true)] : [])]); },
    };
}
