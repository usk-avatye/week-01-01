import { timingSafeEqual } from 'node:crypto';
import { parse } from 'cookie';
import type { Request, RequestHandler } from 'express';
import type { Role } from '../../contracts/auth.js';
import { ApiError } from '../http/errors.js';
import type { AuthService } from './service.js';
import type { SessionActor } from './actor.js';
export const SESSION_COOKIE = 'campaign_guard_session';
export function actor(req: Request): SessionActor {
    if (!req.actor)
        throw new ApiError(401, 'LOGIN_REQUIRED', '로그인이 필요합니다.');
    return req.actor;
}
export function authenticateRequest(auth: AuthService): RequestHandler {
    return async (req, _res, next) => {
        const token = parse(req.headers.cookie ?? '')[SESSION_COOKIE] ?? '';
        req.actor = await auth.authenticate(token);
        actor(req);
        next();
    };
}
export function requireRole(role: Role): RequestHandler {
    return (req, _res, next) => {
        if (actor(req).member.role !== role)
            throw new ApiError(403, 'ROLE_FORBIDDEN', '이 계정에 허용되지 않은 작업입니다.');
        next();
    };
}
export const requireCsrf: RequestHandler = (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method))
        return next();
    const expected = actor(req).csrfToken, received = req.get('X-CSRF-Token') ?? '';
    const receivedBytes = Buffer.from(received), expectedBytes = Buffer.from(expected);
    if (receivedBytes.length !== expectedBytes.length || !timingSafeEqual(receivedBytes, expectedBytes)) {
        throw new ApiError(403, 'CSRF_FAILED', '요청을 확인할 수 없습니다. 페이지를 새로고침해 주세요.');
    }
    next();
};
