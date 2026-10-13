export class ClientError extends Error {
    constructor(public readonly status: number, public readonly code: string, text: string) { super(text); }
}
export function createApi(csrfToken = '', signal?: AbortSignal) {
    return {
        async request<T>(method: string, path: string, body?: unknown): Promise<T> {
            let response: Response;
            try {
                response = await fetch('/api' + path, {
                    method, credentials: 'same-origin', signal,
                    headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
                    body: body === undefined ? undefined : JSON.stringify(body),
                });
            }
            catch {
                throw new ClientError(0, 'NETWORK_UNKNOWN', '통신 결과를 확인하지 못했습니다. 집행 요청은 기존 번호로 확인해 주세요.');
            }
            if (response.status === 204)
                return undefined as T;
            let data: unknown;
            try {
                data = await response.json();
            }
            catch {
                throw new ClientError(0, 'RESPONSE_UNKNOWN', '서버의 결과를 읽지 못했습니다. 기존 요청으로 확인해 주세요.');
            }
            if (!response.ok) {
                const detail = typeof data === 'object' && data !== null && 'error' in data ? (data as {
                    error: {
                        code?: string;
                        message?: string;
                    };
                }).error : undefined;
                throw new ClientError(response.status, detail?.code ?? 'REQUEST_FAILED', detail?.message ?? '요청을 처리하지 못했습니다.');
            }
            return data as T;
        },
    };
}
export type Api = ReturnType<typeof createApi>;
