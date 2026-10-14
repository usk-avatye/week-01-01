import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import type { AuthDto } from '../../src/contracts/auth.js';
import type { CampaignDto } from '../../src/contracts/campaigns.js';
import type { ExecutionDto } from '../../src/contracts/executions.js';
import { createHttpFixture, TEST_PASSWORD } from '../support/http.js';
import { advertiser } from '../support/advertiser.js';
import { setupCampaign } from '../support/campaign.js';
import { responseProxy } from '../support/transport.js';

interface DemoManifest {
    email: string;
    origin: string;
    scenarios: { action: 'confirm' | 'retry'; campaignId: string; url: string }[];
}

async function availablePort(): Promise<number> {
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as AddressInfo).port;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    return port;
}

async function launch(t: TestContext, schema: string) {
    const directory = await mkdtemp(join(tmpdir(), 'guard-recovery-demo-'));
    const manifestPath = join(directory, 'demo.json');
    const database = new URL(process.env.TEST_DATABASE_URL!);
    database.searchParams.set('options', `-c search_path=${schema}`);
    const port = await availablePort();
    const child = spawn('npm', ['run', '--silent', 'demo:recovery', '--', '--port', String(port)], {
        env: { ...process.env, DATABASE_URL: database.toString(), RECOVERY_DEMO_OUTPUT: manifestPath },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit');
    let output = '';
    child.stdout.on('data', chunk => { output += String(chunk); });
    child.stderr.on('data', chunk => { output += String(chunk); });
    async function close() {
        if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid!, 'SIGTERM');
        await exited;
    }
    t.after(async () => { await close(); await rm(directory, { recursive: true, force: true }); });
    const deadline = Date.now() + 15000;
    let manifest: DemoManifest | undefined;
    while (!manifest) {
        try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as DemoManifest; }
        catch {
            if (child.exitCode !== null || child.signalCode !== null)
                assert.fail('시연 명령이 링크를 준비하지 못했습니다.\n' + output);
            if (Date.now() > deadline) assert.fail('시연 명령이 시작되지 않았습니다.\n' + output);
            await new Promise(resolve => setTimeout(resolve, 25));
        }
    }
    assert.equal(manifest.origin, `http://localhost:${port}`);
    return { manifest, close };
}

test('recovery demo drops one committed response per scenario and recovers through confirmation or retry', async t => {
    const f = await createHttpFixture(); t.after(() => f.close());
    await advertiser(f, 'advertiser-a@example.test');
    const { manifest } = await launch(t, f.schema);
    assert.equal(manifest.email, 'advertiser-a@example.test');
    assert.deepEqual(manifest.scenarios.map(scenario => scenario.action), ['confirm', 'retry']);
    const page = await fetch(manifest.scenarios[0]!.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Campaign Guard/);
    const login = await fetch(manifest.origin + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: manifest.origin },
        body: JSON.stringify({ email: manifest.email, password: TEST_PASSWORD }),
    });
    assert.equal(login.status, 200);
    const auth = await login.json() as AuthDto;
    const headers = { 'Content-Type': 'application/json', Origin: manifest.origin,
        Cookie: login.headers.get('set-cookie')!.split(';')[0]!, 'X-CSRF-Token': auth.csrfToken };
    for (const scenario of manifest.scenarios) {
        assert.equal(scenario.url, `${manifest.origin}/#/campaigns/${scenario.campaignId}`);
        const base = manifest.origin + '/api/campaigns/' + scenario.campaignId;
        const before = await (await fetch(base, { headers })).json() as CampaignDto;
        assert.equal(before.status, 'ACTIVE');
        assert.equal(before.totalBudget, 10000);
        assert.equal(before.spentAmount, 0);
        const preparation = await fetch(base + '/preparations', { method: 'POST', headers, body: '{}' });
        assert.equal(preparation.status, 201);
        const prepared = await preparation.json() as ExecutionDto;
        const endpoint = base + '/executions/' + prepared.requestId;
        const invalid = await fetch(endpoint, { method: 'POST', headers, body: '{"amount":0}' });
        assert.equal(invalid.status, 400, '입력 오류는 첫 성공 응답 유실을 소비하지 않습니다.');
        await assert.rejects(fetch(endpoint, { method: 'POST', headers, body: '{"amount":1000}' }));
        const ledger = (await f.pool.query('SELECT spent_amount FROM campaigns WHERE id=$1', [scenario.campaignId])).rows[0];
        assert.equal(ledger.spent_amount, '1000', '응답 유실 전에 실제 승인과 비용이 커밋됩니다.');
        const recovered = await fetch(endpoint, scenario.action === 'confirm'
            ? { headers } : { method: 'POST', headers, body: '{"amount":1000}' });
        assert.equal(recovered.status, 200);
        const result = await recovered.json() as ExecutionDto;
        assert.equal(result.status, 'APPROVED');
        assert.equal(result.requestId, prepared.requestId);
        assert.equal(result.approvedAmount, 1000);
        const again = await fetch(endpoint, { method: 'POST', headers, body: '{"amount":1000}' });
        assert.equal(again.status, 200);
        assert.deepEqual(await again.json(), result);
        assert.equal((await f.pool.query('SELECT spent_amount FROM campaigns WHERE id=$1', [scenario.campaignId])).rows[0].spent_amount, '1000');
        assert.equal((await f.pool.query('SELECT count(*) FROM executions WHERE campaign_id=$1', [scenario.campaignId])).rows[0].count, '1');
    }
});

test('restarting the demo prepares fresh campaigns and keeps existing campaign data', async t => {
    const f = await createHttpFixture(); t.after(() => f.close());
    const client = await advertiser(f, 'advertiser-a@example.test');
    const original = await setupCampaign(client, 7000, false);
    const first = await launch(t, f.schema);
    await first.close();
    const second = await launch(t, f.schema);
    const firstIds = first.manifest.scenarios.map(scenario => scenario.campaignId);
    for (const scenario of second.manifest.scenarios) assert.ok(!firstIds.includes(scenario.campaignId));
    assert.equal((await f.pool.query('SELECT count(*) FROM campaigns WHERE owner_id=$1', [client.member.id])).rows[0].count, '5');
    const preserved = await client.request<CampaignDto>('GET', original.path);
    assert.equal(preserved.body.name, 'Execution campaign');
    assert.equal(preserved.body.status, 'PAUSED');
    assert.equal(preserved.body.totalBudget, 7000);
    assert.equal(preserved.body.spentAmount, 0);
    const demo = await f.pool.query('SELECT status,total_budget,spent_amount FROM campaigns WHERE id=ANY($1::bigint[])',
        [second.manifest.scenarios.map(scenario => scenario.campaignId)]);
    assert.equal(demo.rows.length, 2);
    for (const campaign of demo.rows) {
        assert.equal(campaign.status, 'ACTIVE');
        assert.equal(campaign.total_budget, '10000');
        assert.equal(campaign.spent_amount, '0');
    }
});

test('the proxy rejects foreign request targets without forwarding session credentials', async t => {
    let foreignRequests = 0;
    const foreign = http.createServer((_req, res) => { foreignRequests++; res.end('foreign'); });
    const backend = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ cookie: req.headers.cookie, csrf: req.headers['x-csrf-token'] }));
    });
    async function listen(server: http.Server) {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        t.after(async () => {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        });
        return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }
    const foreignUrl = await listen(foreign), backendUrl = await listen(backend);
    const proxy = await responseProxy(backendUrl, { dropFirstExecutionFor: new Set() });
    t.after(() => proxy.close());
    const headers = { Cookie: 'test-session-only', 'X-CSRF-Token': 'test-csrf-only' };
    const relative = await fetch(proxy.url + '//' + new URL(foreignUrl).host + '/foreign', { headers });
    assert.equal(relative.status, 400);
    await relative.text();
    const address = new URL(proxy.url);
    const absolute = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const request = http.request({ hostname: address.hostname, port: address.port, path: foreignUrl + '/foreign', headers }, resolve);
        request.on('error', reject);
        request.end();
    });
    absolute.resume();
    await once(absolute, 'end');
    assert.equal(absolute.statusCode, 400);
    assert.equal(foreignRequests, 0);
    const allowed = await fetch(proxy.url + '/api/auth/me', { headers });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { cookie: 'test-session-only', csrf: 'test-csrf-only' });
});
