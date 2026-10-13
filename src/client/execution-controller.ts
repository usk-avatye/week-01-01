import type { ExecutionDto } from '../contracts/executions.js';
import type { PageContext } from './context.js';
import { acceptExecutionResult } from './execution-flow.js';
import { clearPending, discardCorruptPending, loadPending, savePending, type PendingRequest } from './pending-store.js';
import { errorText } from './dom.js';
export function executionController(context: PageContext, campaignId: string, storage: Storage, changed: () => void, completed: () => Promise<void>) {
    const base = `/campaigns/${campaignId}`, memberId = context.member.id;
    let busy = false, notice = '', error = false, receipt: ExecutionDto | undefined;
    const pending = () => loadPending(storage, memberId, campaignId);
    async function run(work: () => Promise<void>): Promise<void> {
        if (busy || context.signal.aborted)
            return;
        busy = true;
        error = false;
        notice = '처리 중입니다.';
        changed();
        try {
            await work();
        }
        catch (cause) {
            notice = errorText(cause);
            error = true;
        }
        finally {
            busy = false;
            if (!context.signal.aborted)
                changed();
        }
    }
    function requirePending(expected: PendingRequest): PendingRequest {
        const saved = pending();
        if (saved.kind !== 'valid')
            throw new Error('보관한 요청을 확인할 수 없습니다. 새 집행을 진행하지 마세요.');
        if (saved.request.memberId !== expected.memberId || saved.request.campaignId !== expected.campaignId ||
            saved.request.requestId !== expected.requestId || saved.request.phase !== expected.phase || saved.request.amount !== expected.amount)
            throw new Error('다른 화면에서 요청 정보가 바뀌었습니다. 갱신된 번호와 금액을 확인해 주세요.');
        return saved.request;
    }
    async function accept(request: PendingRequest, result: ExecutionDto): Promise<void> {
        const next = acceptExecutionResult(request, result);
        if (next.kind === 'UNRESOLVED') {
            notice = '아직 확정 결과를 확인하지 못했습니다.';
            return;
        }
        clearPending(storage, request);
        receipt = next.result;
        notice = '';
        await completed();
    }
    return {
        snapshot: () => ({ pending: pending(), busy, notice, error, receipt }),
        prepare: () => run(async () => {
            if (pending().kind !== 'empty')
                throw new Error('기존 요청의 결과를 먼저 확인해 주세요.');
            const result = await context.api.request<ExecutionDto>('POST', base + '/preparations', {});
            savePending(storage, { memberId, campaignId, requestId: result.requestId, phase: 'PREPARED', amount: null });
            receipt = undefined;
            notice = '';
        }),
        adopt: (requestId: string) => run(async () => {
            if (pending().kind !== 'empty')
                throw new Error('이미 선택한 요청의 결과를 먼저 확인해 주세요.');
            const result = await context.api.request<ExecutionDto>('GET', base + '/executions/' + requestId);
            if (result.status !== 'PREPARED')
                throw new Error('이미 처리된 요청입니다. 집행 이력을 확인해 주세요.');
            savePending(storage, { memberId, campaignId, requestId, phase: 'PREPARED', amount: null });
            receipt = undefined;
            notice = '';
        }),
        execute: (expected: PendingRequest, amount: number) => run(async () => {
            const request = requirePending(expected);
            if (request.phase === 'UNRESOLVED' && request.amount !== amount)
                throw new Error('결과 확인 중인 금액을 바꿀 수 없습니다.');
            if (!Number.isInteger(amount) || amount < 1 || amount > 1000000000)
                throw new Error('금액은 1~1,000,000,000원 정수로 입력해 주세요.');
            const locked: PendingRequest = { ...request, phase: 'UNRESOLVED', amount };
            savePending(storage, locked);
            changed();
            const result = await context.api.request<ExecutionDto>('POST', `${base}/executions/${request.requestId}`, { amount });
            await accept(locked, result);
        }),
        query: (expected: PendingRequest) => run(async () => {
            const request = requirePending(expected);
            const result = await context.api.request<ExecutionDto>('GET', `${base}/executions/${request.requestId}`);
            if (request.phase === 'UNRESOLVED')
                await accept(request, result);
            else if (result.status === 'PREPARED')
                notice = '준비 상태입니다.';
            else
                throw new Error('다른 화면에서 처리된 번호입니다. 집행 이력을 확인해 주세요.');
        }),
        resetCorrupt: () => { discardCorruptPending(storage, memberId, campaignId); notice = '보관 정보를 정리했습니다. 이력과 준비 번호를 다시 확인해 주세요.'; changed(); },
    };
}
export type ExecutionController = ReturnType<typeof executionController>;
