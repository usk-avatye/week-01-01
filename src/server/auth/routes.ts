import { Router } from 'express';
import type { AppConfig } from '../config.js';
import { actor, authenticateRequest, requireCsrf, SESSION_COOKIE } from './middleware.js';
import { authenticationRateLimit } from './rate-limit.js';
import { SESSION_MS, type AuthService } from './service.js';
export function createAuthRoutes(auth: AuthService, config: AppConfig): Router {
    const router = Router(), limit = authenticationRateLimit(), authenticate = authenticateRequest(auth);
    const cookie = { httpOnly: true, sameSite: 'strict' as const, secure: config.secureCookies, path: '/' };
    router.post('/signup', limit, async (req, res) => { res.status(201).json(await auth.signup(req.body)); });
    router.post('/login', limit, async (req, res) => {
        const result = await auth.login(req.body);
        res.cookie(SESSION_COOKIE, result.token, { ...cookie, maxAge: SESSION_MS }).json(result.auth);
    });
    router.get('/me', authenticate, (req, res) => {
        const { member, csrfToken } = actor(req);
        res.json({ member, csrfToken });
    });
    router.post('/logout', authenticate, requireCsrf, async (req, res) => {
        await auth.logout(actor(req).tokenHash);
        res.clearCookie(SESSION_COOKIE, cookie).status(204).end();
    });
    return router;
}
