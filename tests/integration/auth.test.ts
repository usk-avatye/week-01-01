import assert from 'node:assert/strict';
import test from 'node:test';
import { createHttpFixture, TEST_PASSWORD } from '../support/http.js';
import type { AuthDto, MemberDto } from '../../src/contracts/auth.js';
test('signup creates only an advertiser and rejects forged role and duplicate email', async (t) => {
    const f = await createHttpFixture();
    t.after(() => f.close());
    const signed = await f.request<MemberDto>('POST', '/api/auth/signup', { email: ' A@Example.Test ', password: TEST_PASSWORD, displayName: 'A' });
    assert.equal(signed.status, 201);
    assert.equal(signed.body.role, 'ADVERTISER');
    assert.equal(signed.body.email, 'a@example.test');
    assert.equal((await f.signup('a@example.test')).status, 409);
    assert.equal((await f.request('POST', '/api/auth/signup', { email: 'x@example.test', password: TEST_PASSWORD, displayName: 'X', role: 'ADMIN' })).status, 400);
});
test('login enforces credentials, actual role and a private eight-hour server session', async (t) => {
    const f = await createHttpFixture();
    t.after(() => f.close());
    await f.signup();
    assert.equal((await f.request('POST', '/api/auth/login', { email: 'a@example.test', password: 'Incorrect-Password!', portal: 'advertiser' })).status, 401);
    assert.equal((await f.login('a@example.test', 'admin')).status, 403);
    const logged = await f.login();
    assert.equal(logged.status, 200);
    assert.ok(logged.cookie);
    const me = await f.request<AuthDto>('GET', '/api/auth/me', undefined, logged.cookie);
    assert.equal(me.status, 200);
    assert.equal(me.body.member.role, 'ADVERTISER');
    assert.ok(me.body.csrfToken);
    const session = await f.pool.query('SELECT token_hash, EXTRACT(EPOCH FROM expires_at-created_at) AS seconds FROM sessions');
    assert.equal(Number(session.rows[0].seconds), 28800);
    assert.notEqual(session.rows[0].token_hash, logged.cookie.split('=')[1]);
    assert.equal('passwordHash' in me.body.member, false);
});
test('logout requires CSRF protection and invalidates the server session', async (t) => {
    const f = await createHttpFixture();
    t.after(() => f.close());
    await f.signup();
    const logged = await f.login();
    assert.equal((await f.request('POST', '/api/auth/logout', {}, logged.cookie)).status, 403);
    assert.equal((await f.request('POST', '/api/auth/logout', {}, logged.cookie, logged.body.csrfToken)).status, 204);
    assert.equal((await f.request('GET', '/api/auth/me', undefined, logged.cookie)).status, 401);
});
test('expired database sessions do not authenticate', async (t) => {
    const f = await createHttpFixture();
    t.after(() => f.close());
    await f.signup();
    const logged = await f.login();
    await f.pool.query("UPDATE sessions SET created_at=clock_timestamp()-interval '9 hours',expires_at=clock_timestamp()-interval '1 hour'");
    assert.equal((await f.request('GET', '/api/auth/me', undefined, logged.cookie)).status, 401);
});
test('invalid multi-byte CSRF token is forbidden rather than a server failure', async (t) => {
    const f = await createHttpFixture();
    t.after(() => f.close());
    await f.signup();
    const logged = await f.login();
    const wrong = 'é'.repeat(logged.body.csrfToken.length);
    assert.equal((await f.request('POST', '/api/auth/logout', {}, logged.cookie, wrong)).status, 403);
    assert.equal((await f.request('GET', '/api/auth/me', undefined, logged.cookie)).status, 200);
});
