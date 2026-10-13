import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { authPage } from '../../src/client/auth-page.js';
import { ClientError, type Api } from '../../src/client/api.js';
import { createHttpFixture, TEST_PASSWORD } from '../support/http.js';

for (const [role, destination] of [['ADVERTISER', '#/campaigns'], ['ADMIN', '#/admin/campaigns']] as const) {
    test(`the common login form routes a DB ${role} account to ${destination}`, async t => {
        const f = await createHttpFixture(); t.after(() => f.close());
        await f.signup('member@example.test', 'Member');
        if (role === 'ADMIN') await f.pool.query("UPDATE members SET role='ADMIN' WHERE email='member@example.test'");
        const dom = new JSDOM('<main></main>', { url: 'http://localhost:3000/#/login' });
        const originals = new Map(['document', 'location'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
        Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
        Object.defineProperty(globalThis, 'location', { value: dom.window.location, configurable: true });
        t.after(() => {
            for (const [key, descriptor] of originals) {
                if (descriptor) Object.defineProperty(globalThis, key, descriptor);
                else Reflect.deleteProperty(globalThis, key);
            }
            dom.window.close();
        });
        const api: Api = { async request<T>(method: string, path: string, body?: unknown): Promise<T> {
            const reply = await f.request<T>(method, '/api' + path, body);
            if (reply.status >= 400) throw new ClientError(reply.status, 'HTTP_FAILURE', '로그인 실패');
            return reply.body;
        } };
        const host = dom.window.document.querySelector('main')!;
        authPage(host, api, 'login');
        host.querySelector<HTMLInputElement>('[name="email"]')!.value = 'member@example.test';
        host.querySelector<HTMLInputElement>('[name="password"]')!.value = TEST_PASSWORD;
        const submit = host.querySelector<HTMLButtonElement>('[type="submit"]')!;
        host.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }));
        const deadline = Date.now() + 3000;
        while (submit.disabled) {
            if (Date.now() >= deadline) throw new Error('Login form did not settle');
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        assert.equal(dom.window.location.hash, destination);
        assert.equal((await f.pool.query('SELECT * FROM sessions')).rowCount, 1);
    });
}
