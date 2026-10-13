import type { ErrorRequestHandler } from 'express';
export class ApiError extends Error {
    constructor(public readonly status: number, public readonly code: string, message: string) {
        super(message);
    }
}
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (res.headersSent)
        return;
    if (error instanceof ApiError) {
        res.status(error.status).json({ error: { code: error.code, message: error.message } });
        return;
    }
    if (error instanceof SyntaxError && 'body' in error) {
        res.status(400).json({ error: { code: 'INVALID_JSON', message: 'JSON 형식이 올바르지 않습니다.' } });
        return;
    }
    console.error('Request failed:', error instanceof Error ? error.name : 'unknown error');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '처리 결과를 확인하지 못했습니다. 기존 요청으로 다시 확인해 주세요.' } });
};
export function notFound(): ApiError { return new ApiError(404, 'NOT_FOUND', '요청한 항목을 찾을 수 없습니다.'); }
