import type { ExecutionController } from './execution-controller.js';
import { amountInput, button, el, field, message } from './dom.js';
import { executionReceipt } from './execution-receipt.js';
export function renderExecutionPanel(host: HTMLElement, controller: ExecutionController): void {
    const state = controller.snapshot(), card = el('section', '', 'card');
    card.append(el('h2', '모의 집행'));
    if (state.pending.kind === 'corrupt') {
        card.append(el('p', '보관 정보가 손상되었습니다. 집행 이력을 먼저 확인하세요.', 'message error'));
        const acknowledge = el('input');
        acknowledge.type = 'checkbox';
        acknowledge.id = 'review-storage';
        const label = el('label', '', 'checkbox-label');
        label.append(acknowledge, document.createTextNode(' 미확정 집행이 없음을 확인했습니다.'));
        const reset = button('보관 정보 정리', () => controller.resetCorrupt(), 'button subtle');
        reset.disabled = true;
        acknowledge.addEventListener('change', () => { reset.disabled = !acknowledge.checked; });
        card.append(label, reset);
    }
    else {
        const request = state.pending.kind === 'valid' ? state.pending.request : undefined, unresolved = request?.phase === 'UNRESOLVED';
        if (unresolved)
            card.append(el('p', `요청 #${request.requestId}: 결과 미확정`, 'request-identity'));
        const amount = amountInput('amount', request?.amount ?? state.draftAmount);
        amount.disabled = state.busy || unresolved;
        const form = el('form', '', 'inline-form'), submit = button(unresolved ? '다시 시도' : '집행 요청', () => { });
        submit.type = 'submit';
        submit.disabled = state.busy;
        form.append(field('집행 금액 (원)', amount), submit);
        form.addEventListener('submit', event => { event.preventDefault(); void controller.execute(request, unresolved ? request.amount! : Number(amount.value)); });
        card.append(form);
        if (unresolved) {
            const query = button('결과 확인', () => controller.query(request), 'button subtle');
            query.disabled = state.busy;
            card.append(query);
            card.append(el('p', '결과를 확인하거나 같은 요청으로 다시 시도하세요.', 'muted'));
        }
    }
    if (state.receipt)
        card.append(executionReceipt(state.receipt));
    const notice = el('p');
    message(notice, state.notice, state.error);
    card.append(notice);
    host.replaceChildren(card);
}
