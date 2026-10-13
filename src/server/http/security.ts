import type { RequestHandler } from 'express';
import { ApiError } from './errors.js';
export function protectApi(origin: string): RequestHandler {
    return (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            if (!req.is('application/json'))
                throw new ApiError(400, 'JSON_REQUIRED', 'JSON 입력이 필요합니다.');
            if ((req.get('Origin') && req.get('Origin') !== origin) || req.get('Sec-Fetch-Site') === 'cross-site') {
                throw new ApiError(403, 'ORIGIN_FORBIDDEN', '허용되지 않은 요청 출처입니다.');
            }
        }
        next();
    };
}
