import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { startServer } from './control.mjs';
import { createRequester } from './http.mjs';

const label = process.argv[2] ?? 'http-smoke';
assert.match(label, /^[a-z][a-z0-9-]*$/);
const api = await startServer(), log = [];
const requester = createRequester(api.info.url, 1);
try {
    const signup = await requester.request('POST', '/api/auth/signup', { email: 'smoke@example.test', password: 'Performance-Local-2026!', displayName: 'Smoke' });
    assert.equal(signup.status, 201); log.push({ step: 'signup', status: signup.status, memberId: signup.data.id });
    const login = await requester.request('POST', '/api/auth/login', { email: 'smoke@example.test', password: 'Performance-Local-2026!' });
    assert.equal(login.status, 200); log.push({ step: 'login', status: login.status, role: login.data.member.role });
    const authenticated = createRequester(api.info.url, 1, { cookie: login.cookie, csrfToken: login.data.csrfToken });
    async function step(name, method, path, body, expected = 200) {
        const reply = await authenticated.request(method, path, body); assert.equal(reply.status, expected);
        log.push({ step: name, status: reply.status, data: reply.data }); return reply.data;
    }
    const created = await step('create paused campaign', 'POST', '/api/campaigns', { name: 'Presentation smoke', totalBudget: 5000 }, 201);
    const path = `/api/campaigns/${created.id}`;
    await step('set budget', 'PATCH', path + '/budget', { totalBudget: 10000 });
    await step('activate', 'PATCH', path + '/status', { status: 'ACTIVE' });
    const first = await step('prepare approved request', 'POST', path + '/preparations', {}, 201);
    const approved = await step('approve', 'POST', path + '/executions/' + first.requestId, { amount: 1000 });
    assert.equal(approved.status, 'APPROVED');
    assert.deepEqual(await step('replay approval', 'POST', path + '/executions/' + first.requestId, { amount: 1000 }), approved);
    const second = await step('prepare rejected request', 'POST', path + '/preparations', {}, 201);
    const rejected = await step('reject insufficient budget', 'POST', path + '/executions/' + second.requestId, { amount: 20000 });
    assert.equal(rejected.status, 'REJECTED');
    await step('pause', 'PATCH', path + '/status', { status: 'PAUSED' });
    await step('increase budget', 'PATCH', path + '/budget', { totalBudget: 50000 });
    await step('resume', 'PATCH', path + '/status', { status: 'ACTIVE' });
    assert.deepEqual(await step('replay rejection', 'POST', path + '/executions/' + second.requestId, { amount: 20000 }), rejected);
    const current = await step('verify charged once', 'GET', path);
    assert.equal(current.spentAmount, 1000);
    authenticated.close();
    await writeFile(`performance/results/verification/${label}.json`, JSON.stringify({ passed: true, at: new Date().toISOString(), steps: log }, null, 2) + '\n');
    console.log(JSON.stringify({ passed: true, steps: log.length, spentAmount: current.spentAmount }));
} finally { requester.close(); await api.close(); }
