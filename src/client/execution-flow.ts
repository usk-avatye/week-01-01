import type { ExecutionDto } from '../contracts/executions.js';
import type { PendingRequest } from './pending-store.js';
export type FlowResult = {
    kind: 'UNRESOLVED';
    request: PendingRequest;
} | {
    kind: 'TERMINAL';
    result: ExecutionDto;
};
export function acceptExecutionResult(request: PendingRequest, result: ExecutionDto): FlowResult {
    if (request.phase !== 'UNRESOLVED' || request.amount === null ||
        result.campaignId !== request.campaignId || result.requestId !== request.requestId) {
        throw new Error('현재 요청과 다른 결과입니다. 기존 번호로 다시 확인해 주세요.');
    }
    if (result.status === 'PREPARED' && result.requestedAmount === null && result.approvedAmount === 0 && result.processedAt === null && result.rejectionReason === null) {
        return { kind: 'UNRESOLVED', request };
    }
    const approved = result.status === 'APPROVED' && result.approvedAmount === request.amount && result.rejectionReason === null;
    const rejected = result.status === 'REJECTED' && result.approvedAmount === 0 &&
        (result.rejectionReason === 'CAMPAIGN_PAUSED' || result.rejectionReason === 'INSUFFICIENT_BUDGET');
    if (result.requestedAmount !== request.amount || !result.processedAt || !Number.isFinite(Date.parse(result.processedAt)) || (!approved && !rejected)) {
        throw new Error('집행 결과가 보관한 요청과 일치하지 않습니다. 이력을 확인해 주세요.');
    }
    return { kind: 'TERMINAL', result };
}
