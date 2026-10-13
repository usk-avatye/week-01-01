import type { ExecutionDto } from '../contracts/executions.js';
import type { PageContext } from './context.js';
import { button, el, errorText, message } from './dom.js';
import { executionReceipt } from './execution-receipt.js';

export function executionReplay(context: PageContext, prefix: string, columns: number) {
    const detail = el('tr', '', 'replay-feedback-row'), cell = el('td'), feedback = el('div', '', 'row-feedback');
    cell.colSpan = columns;
    feedback.setAttribute('role', 'status');
    cell.append(feedback);
    detail.append(cell);
    let revision = 0;
    return (row: HTMLTableRowElement, result: ExecutionDto): HTMLButtonElement => {
        const replay = button('동일 요청 재전송', async () => {
            if (context.signal.aborted || !row.isConnected) return;
            const ticket = ++revision;
            replay.disabled = true;
            const pending = el('p');
            message(pending, '재전송 중');
            feedback.replaceChildren(pending);
            row.after(detail);
            try {
                const receipt = await context.api.request<ExecutionDto>('POST', `${prefix}/executions/${result.requestId}`, { amount: result.requestedAmount });
                if (context.signal.aborted || ticket !== revision || !detail.isConnected) return;
                feedback.replaceChildren(executionReceipt(receipt));
                feedback.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            } catch (error) {
                if (context.signal.aborted || ticket !== revision || !detail.isConnected) return;
                const notice = el('p');
                message(notice, errorText(error), true);
                feedback.replaceChildren(notice);
                feedback.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            } finally {
                replay.disabled = false;
            }
        }, 'button subtle small');
        return replay;
    };
}
