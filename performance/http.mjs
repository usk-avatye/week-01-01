import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { summarize } from './stats.mjs';

export function createRequester(url, concurrency, credentials = {}) {
    const base = new URL(url), agent = new http.Agent({ keepAlive: true, maxSockets: concurrency });
    return { close() { agent.destroy(); }, async request(method, path, body) {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const start = performance.now();
        return new Promise(resolve => {
            const request = http.request({ hostname: base.hostname, port: base.port, path, method, agent,
                headers: { Origin: url, 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
                    ...(credentials.cookie ? { Cookie: credentials.cookie, 'X-CSRF-Token': credentials.csrfToken } : {}) } }, response => {
                let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; });
                response.on('end', () => {
                    let data, parseError = false;
                    try { data = text ? JSON.parse(text) : null; } catch { parseError = true; }
                    resolve({ latencyMs: performance.now() - start, status: response.statusCode, data, parseError,
                        cookie: response.headers['set-cookie']?.[0]?.split(';')[0] ?? '' });
                });
                response.on('error', error => resolve({ latencyMs: performance.now() - start, status: 0, networkError: error.code }));
            });
            request.setTimeout(10000, () => request.destroy(new Error('Request timeout')));
            request.on('error', error => resolve({ latencyMs: performance.now() - start, status: 0, networkError: error.code ?? error.message }));
            request.end(payload);
        });
    } };
}
export async function load(requester, { scenario, concurrency, count, offset, campaigns, jobs }) {
    const records = [];
    let next = 0;
    const started = performance.now(), cpu = process.cpuUsage();
    async function send(index, operation, path, body, requestId) {
        const relativeStartMs = performance.now() - started;
        const reply = await requester.request('POST', path, body);
        const value = reply.data;
        const expected = operation === 'prepare' ? reply.status === 201 && value?.status === 'PREPARED' && typeof value.requestId === 'string'
            : reply.status === 200 && value?.status === 'APPROVED' && value.approvedAmount === 1 && value.requestedAmount === 1 && value.requestId === requestId;
        records.push({ index, operation, relativeStartMs, latencyMs: reply.latencyMs, status: reply.status,
            outcome: value?.status ?? null, error: !expected || Boolean(reply.parseError), code: reply.networkError ?? value?.error?.code ?? null });
        return value;
    }
    await Promise.all(Array.from({ length: concurrency }, async () => {
        while (next < count) {
            const index = next++, job = jobs[offset + index];
            if (scenario === 'A' || scenario === 'B') await send(index, 'execute', `/api/campaigns/${job.campaignId}/executions/${job.requestId}`, { amount: 1 }, job.requestId);
            else {
                const value = await send(index, 'prepare', `/api/campaigns/${campaigns[0]}/preparations`, {});
                if (scenario === 'D' && value?.requestId) await send(index, 'execute', `/api/campaigns/${campaigns[0]}/executions/${value.requestId}`, { amount: 1 }, value.requestId);
            }
        }
    }));
    const elapsedMs = performance.now() - started, usage = process.cpuUsage(cpu);
    const operations = {};
    for (const name of ['prepare', 'execute']) {
        const rows = records.filter(row => row.operation === name);
        if (rows.length) operations[name] = summarize(rows, elapsedMs);
    }
    return { records, summary: summarize(records, elapsedMs), operations, workItems: count, workItemsPerSecond: count * 1000 / elapsedMs,
        generatorCpuOneCorePercent: (usage.user + usage.system) / (elapsedMs * 10), generatorRssBytes: process.memoryUsage().rss };
}
