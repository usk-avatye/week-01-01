import type { ExecutionDto } from '../contracts/executions.js';
import { el, money, time } from './dom.js';
export const statusText = (result: ExecutionDto) => result.status === 'APPROVED' ? '승인' : result.status === 'PREPARED' ? '준비' : '거절';
export const reasonText = (result: ExecutionDto) => result.rejectionReason === 'CAMPAIGN_PAUSED' ? '캠페인 일시정지' : result.rejectionReason === 'INSUFFICIENT_BUDGET' ? '예산 부족' : '—';
export function executionReceipt(result: ExecutionDto): HTMLElement {
    const box = el('div', '', `receipt ${result.status.toLowerCase()}`);
    box.append(el('strong', `요청 #${result.requestId}: ${statusText(result)}`), el('p', `요청 ${money(result.requestedAmount ?? 0)} / 차감 ${money(result.approvedAmount)}`));
    if (result.rejectionReason) box.append(el('p', reasonText(result)));
    box.append(el('p', time(result.processedAt), 'muted'));
    return box;
}
