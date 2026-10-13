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
    else if (state.pending.kind === 'empty') {
        const prepare = button('요청 번호 준비', () => controller.prepare());
        prepare.disabled = state.busy;
        card.append(prepare);
    }
    else {
        const request = state.pending.request, unresolved = request.phase === 'UNRESOLVED';
        card.append(el('p', `요청 #${request.requestId}: ${unresolved ? '결과 미확정' : '준비 완료'}`, 'request-identity'));
        const amount = amountInput('amount', request.amount ?? 1000);
        amount.disabled = state.busy || unresolved;
        const form = el('form', '', 'inline-form'), submit = button(unresolved ? '같은 요청 재전송' : '집행 요청', () => { });
        submit.type = 'submit';
        submit.disabled = state.busy;
        form.append(field('집행 금액 (원)', amount), submit);
        form.addEventListener('submit', event => { event.preventDefault(); void controller.execute(request, unresolved ? request.amount! : Number(amount.value)); });
        const query = button('결과 조회', () => controller.query(request), 'button subtle');
        query.disabled = state.busy;
        card.append(form, query);
        if (unresolved)
            card.append(el('p', '같은 번호와 금액으로 결과를 확인하세요.', 'muted'));
    }
    if (state.receipt)
        card.append(executionReceipt(state.receipt));
    const notice = el('p');
    message(notice, state.notice, state.error);
    card.append(notice);
    host.replaceChildren(card);
}
