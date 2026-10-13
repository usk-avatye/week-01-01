import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { describeWaits } from './stats.mjs';

export function instrumentPool(pool) {
    let active = false, started = 0, cpu, timer, samples = [], acquired = [];
    const loop = monitorEventLoopDelay({ resolution: 10 });
    const original = pool.connect.bind(pool);
    pool.connect = callback => {
        const begin = performance.now();
        const record = () => { if (active) acquired.push(performance.now() - begin); };
        if (typeof callback === 'function') return original((error, client, release) => { record(); callback(error, client, release); });
        return original().then(client => { record(); return client; });
    };
    function snapshot() { samples.push({ elapsedMs: performance.now() - started, total: pool.totalCount,
        idle: pool.idleCount, used: pool.totalCount - pool.idleCount, waiting: pool.waitingCount }); }
    return {
        start() { samples = []; acquired = []; started = performance.now(); cpu = process.cpuUsage(); loop.reset(); loop.enable(); active = true; snapshot(); timer = setInterval(snapshot, 20); },
        stop() {
            snapshot(); clearInterval(timer); active = false; loop.disable();
            const elapsedMs = performance.now() - started, usage = process.cpuUsage(cpu);
            return { poolMax: pool.options.max, elapsedMs, samples, acquireMs: acquired,
                acquire: describeWaits(acquired), maxUsed: Math.max(...samples.map(row => row.used)),
                maxWaiting: Math.max(...samples.map(row => row.waiting)),
                waitingSampleRate: samples.filter(row => row.waiting > 0).length / samples.length,
                cpuOneCorePercent: (usage.user + usage.system) / (elapsedMs * 10),
                eventLoop: { meanMs: Number.isFinite(loop.mean) ? loop.mean / 1e6 : 0, p95Ms: loop.percentile(95) / 1e6,
                    p99Ms: loop.percentile(99) / 1e6, maxMs: loop.max / 1e6 }, rssBytes: process.memoryUsage().rss };
        }, close() { if (timer) clearInterval(timer); loop.disable(); }
    };
}
export function observePostgres(pool, applicationName, intervalMs = 100) {
    let stopping = false;
    const samples = [], errors = [];
    const started = performance.now();
    const finished = (async () => {
        while (!stopping) {
            const begin = performance.now();
            try {
                const activity = await pool.query(`SELECT pid,state,wait_event_type,wait_event,query,
                    pg_blocking_pids(pid) AS blockers,
                    EXTRACT(EPOCH FROM clock_timestamp()-query_start)*1000 AS query_age_ms
                    FROM pg_stat_activity WHERE application_name=$1 ORDER BY pid`, [applicationName]);
                const locks = await pool.query(`SELECT l.pid,l.locktype,l.mode,l.granted,c.relname,l.transactionid::text
                    FROM pg_locks l LEFT JOIN pg_class c ON c.oid=l.relation
                    WHERE l.pid IN (SELECT pid FROM pg_stat_activity WHERE application_name=$1) AND NOT l.granted`, [applicationName]);
                samples.push({ elapsedMs: performance.now() - started, queryMs: performance.now() - begin,
                    activity: activity.rows, locks: locks.rows });
            } catch (error) { errors.push({ elapsedMs: performance.now() - started, message: String(error.message) }); }
            await new Promise(resolve => setTimeout(resolve, Math.max(1, intervalMs - (performance.now() - begin))));
        }
    })();
    return { async stop() {
        stopping = true; await finished;
        let busy = 0, waiting = 0, maxWaiting = 0, waitingSamples = 0;
        const events = {}, queries = {};
        for (const sample of samples) {
            let count = 0;
            for (const row of sample.activity) {
                if (row.state !== 'idle') busy++;
                if (row.wait_event_type === 'Lock') { waiting++; count++; events[row.wait_event] = (events[row.wait_event] ?? 0) + 1;
                    queries[row.query] = (queries[row.query] ?? 0) + 1; }
            }
            if (count) waitingSamples++; maxWaiting = Math.max(maxWaiting, count);
        }
        return { intervalMs, samples, errors, summary: { sampleCount: samples.length, lockWaitingBackendFraction: busy ? waiting / busy : 0,
            lockWaitingSampleRate: samples.length ? waitingSamples / samples.length : 0, maxLockWaiting: maxWaiting, events, queries,
            observerQueryMs: describeWaits(samples.map(row => row.queryMs)) } };
    } };
}
