import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
const execute = promisify(execFile);

export function cpuMilliseconds(value) {
    const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(value);
    assert.ok(match, `Unexpected ps CPU time: ${value}`);
    return ((Number(match[1] ?? 0) * 86400) + (Number(match[2] ?? 0) * 3600) + Number(match[3]) * 60 + Number(match[4])) * 1000;
}
export function summarizeResourceSamples(samples) {
    const previous = new Map();
    let cpuMs = 0, maxAggregateRssBytes = 0, maxProcesses = 0;
    for (const sample of samples) {
        let rssBytes = 0;
        for (const process of sample.processes) {
            if (previous.has(process.pid)) cpuMs += Math.max(0, process.cpuMs - previous.get(process.pid));
            previous.set(process.pid, process.cpuMs); rssBytes += process.rssKiB * 1024;
        }
        maxAggregateRssBytes = Math.max(maxAggregateRssBytes, rssBytes);
        maxProcesses = Math.max(maxProcesses, sample.processes.length);
    }
    const elapsedMs = samples.length > 1 ? samples.at(-1).elapsedMs - samples[0].elapsedMs : 0;
    return { cpuMs, elapsedMs, cpuOneCorePercent: elapsedMs ? cpuMs / elapsedMs * 100 : 0, maxAggregateRssBytes, maxProcesses };
}
export async function observeResources(pool, intervalMs = 250, apiApplicationName) {
    const samples = [], errors = [], started = performance.now();
    const backend = (await pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const parent = Number((await execute('/bin/ps', ['-p', String(backend), '-o', 'ppid='])).stdout.trim());
    assert.ok(Number.isInteger(parent) && parent > 1, 'DB resources require PostgreSQL on this host');
    async function snapshot() {
        const begin = performance.now();
        try {
            const rows = (await pool.query('SELECT pid,backend_type,state,application_name FROM pg_stat_activity WHERE pid IS NOT NULL ORDER BY pid')).rows;
            const ids = [...new Set([parent, ...rows.map(row => row.pid)])];
            const reply = await execute('/bin/ps', ['-p', ids.join(','), '-o', 'pid=,ppid=,time=,rss=,comm='], { timeout: 5000 });
            const processes = reply.stdout.trim().split('\n').filter(Boolean).map(line => {
                const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.+)$/.exec(line);
                assert.ok(match, `Unexpected ps row: ${line}`);
                assert.ok(/postgres/.test(match[5]), 'DB PID must be a PostgreSQL process');
                return { pid: Number(match[1]), parentPid: Number(match[2]), cpuMs: cpuMilliseconds(match[3]),
                    rssKiB: Number(match[4]), process: match[5], backendType: rows.find(row => row.pid === Number(match[1]))?.backend_type ?? 'postmaster' };
            });
            const schema = apiApplicationName?.replace(/^guard_/, '');
            const owned = [apiApplicationName, `pool_observer_${schema}`, `observer_${schema}`];
            const externalActive = apiApplicationName ? rows.filter(row => row.backend_type === 'client backend' && row.state === 'active' && !owned.includes(row.application_name)) : [];
            samples.push({ elapsedMs: performance.now() - started, observationMs: performance.now() - begin, processes, externalActive });
        } catch (error) { errors.push({ elapsedMs: performance.now() - started, message: String(error.message) }); }
    }
    await snapshot();
    let pending;
    const timer = setInterval(() => { if (!pending) pending = snapshot().finally(() => { pending = undefined; }); }, intervalMs);
    return { async stop() { clearInterval(timer); await pending; await snapshot();
        return { intervalMs, scope: 'all PostgreSQL cluster processes including observers and background workers',
            cpuTimeResolutionMs: 10, rssDefinition: 'sum of per-process RSS; shared pages can be counted repeatedly',
            samples, errors, summary: { ...summarizeResourceSamples(samples), externalActiveObservations: samples.reduce((sum, row) => sum + row.externalActive.length, 0) } }; } };
}
