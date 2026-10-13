import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/server/app.js';
import type { AuthDto } from '../../src/contracts/auth.js';
import { createFixture } from './database.js';
export const TEST_PASSWORD = 'Test-Campaign-2026!';
export const TEST_ORIGIN = 'http://localhost:3000';
export interface Reply<T> {
    status: number;
    body: T;
    cookie: string;
}
export async function createHttpFixture() {
    const fixture = await createFixture();
    const app = createApp(fixture.pool, { origin: TEST_ORIGIN, secureCookies: false });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    async function request<T = Record<string, unknown>>(method: string, path: string, body?: unknown, cookie = '', csrf = ''): Promise<Reply<T>> {
        const response = await fetch(url + path, {
            method,
            headers: { 'Content-Type': 'application/json', Origin: TEST_ORIGIN, Cookie: cookie, 'X-CSRF-Token': csrf },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const data = response.status === 204 ? null : await response.json();
        return { status: response.status, body: data as T, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '' };
    }
    async function signup(email = 'a@example.test', name = 'Advertiser A') {
        return request('POST', '/api/auth/signup', { email, password: TEST_PASSWORD, displayName: name });
    }
    async function login(email = 'a@example.test') {
        return request<AuthDto>('POST', '/api/auth/login', { email, password: TEST_PASSWORD });
    }
    return { ...fixture, server, url, request, signup, login, async close() {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
            await fixture.close();
        } };
}
