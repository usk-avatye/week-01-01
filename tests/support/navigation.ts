import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import { TEST_ORIGIN, type createHttpFixture } from './http.js';

let caseNumber = 0;
export function mountNavigation(t: TestContext, fixture: Awaited<ReturnType<typeof createHttpFixture>>, hash: string, cookie = '') {
    const dom = new JSDOM('<main id="app"></main>', { url: TEST_ORIGIN + '/' + hash });
    const nativeFetch = globalThis.fetch;
    const browserFetch: typeof fetch = async (input, init) => {
        const path = String(input);
        assert.ok(path.startsWith('/api/'));
        const headers = new Headers(init?.headers);
        headers.set('Origin', TEST_ORIGIN);
        if (cookie) headers.set('Cookie', cookie);
        const response = await nativeFetch(fixture.url + path, { ...init, headers });
        const issuedCookie = response.headers.get('set-cookie');
        if (issuedCookie) cookie = issuedCookie.split(';')[0]!;
        return response;
    };
    const values = { document: dom.window.document, window: dom.window, location: dom.window.location,
        localStorage: dom.window.localStorage, fetch: browserFetch };
    const originals = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(async () => {
        dom.window.close();
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
        await fixture.close();
    });
    return { dom, async start() {
        await import(new URL(`../../src/client/main.ts?navigationCase=${++caseNumber}`, import.meta.url).href);
    } };
}

export async function waitForNavigation(predicate: () => boolean, message: string): Promise<void> {
    const deadline = Date.now() + 2500;
    while (!predicate()) {
        if (Date.now() >= deadline) assert.fail(message);
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}

export async function goBack(dom: JSDOM): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Back navigation did not settle')), 2500);
        dom.window.addEventListener('popstate', () => { clearTimeout(timer); resolve(); }, { once: true });
        dom.window.history.back();
    });
}
