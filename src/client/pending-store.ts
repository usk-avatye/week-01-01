export interface PendingRequest {
    memberId: string;
    campaignId: string;
    requestId: string;
    phase: 'PREPARED' | 'UNRESOLVED';
    amount: number | null;
}
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type PendingLoad = {
    kind: 'empty';
} | {
    kind: 'corrupt';
} | {
    kind: 'valid';
    request: PendingRequest;
};
const key = (memberId: string, campaignId: string) => `campaign-guard:pending:v1:${memberId}:${campaignId}`;
const id = (value: unknown) => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const money = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1000000000;
export function loadPending(store: Store, memberId: string, campaignId: string): PendingLoad {
    try {
        const saved = store.getItem(key(memberId, campaignId));
        if (saved === null)
            return { kind: 'empty' };
        const value: unknown = JSON.parse(saved);
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return { kind: 'corrupt' };
        const record = value as Record<string, unknown>;
        if (record.memberId !== memberId || record.campaignId !== campaignId || !id(record.requestId) ||
            (record.phase !== 'PREPARED' && record.phase !== 'UNRESOLVED') ||
            (record.phase === 'PREPARED' ? record.amount !== null : !money(record.amount)))
            return { kind: 'corrupt' };
        return { kind: 'valid', request: { memberId, campaignId, requestId: record.requestId as string, phase: record.phase, amount: record.amount as number | null } };
    }
    catch {
        return { kind: 'corrupt' };
    }
}
export function savePending(store: Store, request: PendingRequest): void {
    const current = loadPending(store, request.memberId, request.campaignId);
    if (current.kind === 'corrupt')
        throw new Error('보관한 집행 정보를 확인할 수 없습니다. 먼저 집행 이력을 확인해 주세요.');
    if (current.kind === 'valid' && current.request.phase === 'UNRESOLVED' &&
        (current.request.requestId !== request.requestId || current.request.amount !== request.amount || request.phase !== 'UNRESOLVED')) {
        throw new Error('결과 확인 중인 요청의 번호와 금액을 바꿀 수 없습니다.');
    }
    store.setItem(key(request.memberId, request.campaignId), JSON.stringify(request));
}
export function clearPending(store: Store, request: PendingRequest): void {
    const current = loadPending(store, request.memberId, request.campaignId);
    if (current.kind === 'valid' && current.request.requestId === request.requestId && current.request.amount === request.amount) {
        store.removeItem(key(request.memberId, request.campaignId));
    }
}
export function discardCorruptPending(store: Store, memberId: string, campaignId: string): void {
    if (loadPending(store, memberId, campaignId).kind === 'corrupt')
        store.removeItem(key(memberId, campaignId));
}
