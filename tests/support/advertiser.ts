import type { createHttpFixture } from './http.js';
export async function advertiser(fixture: Awaited<ReturnType<typeof createHttpFixture>>, email = 'a@example.test', name = 'Advertiser A') {
    await fixture.signup(email, name);
    const logged = await fixture.login(email);
    if (logged.status !== 200)
        throw new Error('Advertiser fixture login failed');
    return {
        member: logged.body.member,
        request<T = Record<string, unknown>>(method: string, path: string, body?: unknown) {
            return fixture.request<T>(method, path, body, logged.cookie, logged.body.csrfToken);
        },
    };
}
