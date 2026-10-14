import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { executionController } from '../../src/client/execution-controller.js';
import { renderExecutionPanel } from '../../src/client/execution-panel.js';
import { ClientError, type Api } from '../../src/client/api.js';
import { createHttpFixture } from '../support/http.js';
import { advertiser } from '../support/advertiser.js';
import { prepare, setupCampaign } from '../support/campaign.js';
import { loadPending } from '../../src/client/pending-store.js';

async function idle(controller: ReturnType<typeof executionController>): Promise<void> {
  const deadline = Date.now() + 3000;
  while (controller.snapshot().busy) {
    if (Date.now() >= deadline) throw new Error('UI operation did not settle');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('automatic preparation recovers a lost execution response with one debit and starts the next request', async t => {
  const f = await createHttpFixture(); t.after(() => f.close());
  const client = await advertiser(f), { campaign } = await setupCampaign(client);
  let drop = true;
  const api: Api = { async request<T>(method: string, endpoint: string, body?: unknown) {
    const reply = await client.request<T>(method, '/api' + endpoint, body);
    if (reply.status >= 400) throw new ClientError(reply.status, 'HTTP_FAILURE', '테스트 HTTP 실패');
    if (method === 'POST' && endpoint.includes('/executions/') && drop) {
      drop = false;
      throw new ClientError(0, 'NETWORK_UNKNOWN', '집행 응답 유실');
    }
    return reply.body;
  } };
  const context = { member: client.member, api, signal: new AbortController().signal };
  const dom = new JSDOM('', { url: 'http://localhost:3000' }); t.after(() => dom.window.close());
  const storage = dom.window.localStorage;
  const original = executionController(context, campaign.id, storage, () => {}, async () => {});
  await original.execute(undefined, 2500);
  const saved = loadPending(storage, client.member.id, campaign.id);
  assert.equal(saved.kind, 'valid');
  if (saved.kind !== 'valid') throw new Error('보관한 집행 정보가 없습니다.');
  assert.equal(saved.request.phase, 'UNRESOLVED');
  assert.equal(saved.request.amount, 2500);
  const restored = executionController(context, campaign.id, storage, () => {}, async () => {});
  await restored.execute(saved.request, 2500);
  assert.equal(restored.snapshot().receipt?.status, 'APPROVED');
  assert.equal((await f.pool.query('SELECT spent_amount FROM campaigns WHERE id=$1', [campaign.id])).rows[0].spent_amount, '2500');
  assert.equal(loadPending(storage, client.member.id, campaign.id).kind, 'empty');
  await restored.execute(undefined, 2500);
  assert.equal(restored.snapshot().receipt?.status, 'APPROVED');
  assert.notEqual(restored.snapshot().receipt?.requestId, saved.request.requestId);
  assert.equal((await f.pool.query('SELECT spent_amount FROM campaigns WHERE id=$1', [campaign.id])).rows[0].spent_amount, '5000');
  assert.equal((await f.pool.query('SELECT count(*) FROM executions WHERE campaign_id=$1', [campaign.id])).rows[0].count, '2');
});

test('stale rendered resend cannot charge a new request prepared by another tab', async t => {
  const f = await createHttpFixture(); t.after(() => f.close());
  const client = await advertiser(f), { campaign, path } = await setupCampaign(client);
  const api: Api = { async request<T>(method: string, endpoint: string, body?: unknown) {
    const reply = await client.request<T>(method, '/api' + endpoint, body);
    if (reply.status >= 400) throw new ClientError(reply.status, 'HTTP_FAILURE', '테스트 HTTP 실패');
    return reply.body;
  } };
  const context = { member: client.member, api, signal: new AbortController().signal };
  const dom = new JSDOM('<div id="old"></div><div id="other"></div>', { url: 'http://localhost:3000' });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document'); dom.window.close(); });
  const oldHost = dom.window.document.querySelector<HTMLElement>('#old')!, otherHost = dom.window.document.querySelector<HTMLElement>('#other')!;
  const storage = dom.window.localStorage;
  const old = executionController(context, campaign.id, storage, () => renderExecutionPanel(oldHost, old), async () => {});
  const other = executionController(context, campaign.id, storage, () => renderExecutionPanel(otherHost, other), async () => {});
  await old.adopt((await prepare(client, path)).requestId);
  const original = old.snapshot().pending; assert.equal(original.kind, 'valid');
  if (original.kind !== 'valid') throw new Error('Preparation missing');
  // Old tab retains an unresolved resend form after an actual committed request.
  storage.setItem(`campaign-guard:pending:v1:${client.member.id}:${campaign.id}`, JSON.stringify({ ...original.request, phase: 'UNRESOLVED', amount: 1000 }));
  renderExecutionPanel(oldHost, old);
  renderExecutionPanel(otherHost, other);
  otherHost.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await idle(other);
  assert.equal((await f.pool.query('SELECT spent_amount FROM campaigns WHERE id=$1', [campaign.id])).rows[0].spent_amount, '1000');
  await other.adopt((await prepare(client, path)).requestId);
  assert.match(oldHost.textContent ?? '', /요청 #1: 결과 미확정/);
  oldHost.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await idle(old);
  const second = await client.request<{ status: string }>('GET', path + '/executions/2');
  assert.equal(second.body.status, 'PREPARED');
  assert.equal((await f.pool.query('SELECT spent_amount FROM campaigns WHERE id=$1', [campaign.id])).rows[0].spent_amount, '1000');
  assert.equal(old.snapshot().error, true);
});
