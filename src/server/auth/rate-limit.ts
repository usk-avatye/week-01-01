import type { RequestHandler } from 'express';
import { ApiError } from '../http/errors.js';
export function authenticationRateLimit(): RequestHandler {
    const attempts = new Map<string, {
        count: number;
        expires: number;
    }>();
    return (req, _res, next) => {
        const now = Date.now();
        for (const [key, value] of attempts)
            if (value.expires <= now)
                attempts.delete(key);
        const key = req.ip ?? 'unknown';
        const current = attempts.get(key) ?? { count: 0, expires: now + 5 * 60 * 1000 };
        if (current.count >= 10 || (!attempts.has(key) && attempts.size >= 2048)) {
            throw new ApiError(429, 'TOO_MANY_ATTEMPTS', '로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.');
        }
        current.count++;
        attempts.set(key, current);
        next();
    };
}
