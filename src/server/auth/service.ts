import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import type { AuthDto } from '../../contracts/auth.js';
import { ApiError } from '../http/errors.js';
import { bodyFields, parseName } from '../http/input.js';
import { findMember, insertMember, memberDto } from './member-repository.js';
import { deleteSession, findSession, insertSession } from './session-repository.js';
import { hashPassword, verifyPassword } from './password.js';
import type { SessionActor } from './actor.js';
export const SESSION_MS = 8 * 60 * 60 * 1000;
const dummyHash = `scrypt$32768$8$3$${'00'.repeat(16)}$${'00'.repeat(64)}`;
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
function email(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
        throw new ApiError(400, 'INVALID_EMAIL', '이메일 형식을 확인해 주세요.');
    }
    return value.trim().toLowerCase();
}
function password(value: unknown): string {
    if (typeof value !== 'string' || [...value].length < 15 || [...value].length > 128 || Buffer.byteLength(value) > 1024) {
        throw new ApiError(400, 'INVALID_PASSWORD', '비밀번호는 15~128자로 입력해 주세요.');
    }
    return value;
}
const uniqueViolation = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
export function createAuthService(pool: Pool) {
    return {
        async signup(input: unknown) {
            const fields = bodyFields(input, ['email', 'password', 'displayName']);
            const address = email(fields.email), secret = password(fields.password), name = parseName(fields.displayName);
            const encoded = await hashPassword(secret);
            try {
                return await insertMember(pool, address, encoded, name);
            }
            catch (error) {
                if (uniqueViolation(error))
                    throw new ApiError(409, 'EMAIL_EXISTS', '이미 가입된 이메일입니다.');
                throw error;
            }
        },
        async login(input: unknown): Promise<{
            token: string;
            auth: AuthDto;
        }> {
            const fields = bodyFields(input, ['email', 'password']);
            const address = email(fields.email), secret = password(fields.password);
            const member = await findMember(pool, address);
            const verified = await verifyPassword(secret, member?.password_hash ?? dummyHash);
            if (!member || !verified)
                throw new ApiError(401, 'INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다.');
            const createdAt = new Date(), expiresAt = new Date(createdAt.getTime() + SESSION_MS);
            for (let attempt = 0; attempt < 3; attempt++) {
                const token = randomBytes(32).toString('base64url'), csrfToken = randomBytes(32).toString('base64url');
                try {
                    await insertSession(pool, tokenHash(token), member.id, csrfToken, createdAt, expiresAt);
                    return { token, auth: { member: memberDto(member), csrfToken } };
                }
                catch (error) {
                    if (!uniqueViolation(error))
                        throw error;
                }
            }
            throw new ApiError(503, 'SESSION_UNAVAILABLE', '로그인 세션을 생성하지 못했습니다.');
        },
        async authenticate(token: string): Promise<SessionActor | undefined> {
            if (!/^[A-Za-z0-9_-]{43}$/.test(token))
                return undefined;
            const hash = tokenHash(token), session = await findSession(pool, hash);
            if (!session || session.expires_at.getTime() <= Date.now())
                return undefined;
            return { member: memberDto(session), csrfToken: session.csrf_token, tokenHash: hash };
        },
        async logout(hash: string) { await deleteSession(pool, hash); },
    };
}
export type AuthService = ReturnType<typeof createAuthService>;
