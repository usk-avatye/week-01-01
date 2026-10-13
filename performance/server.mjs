import { createApp } from '../dist/src/server/app.js';
import { createPerformanceFixture, setupWorkload, validateWorkload } from './fixture.mjs';
import { instrumentPool } from './telemetry.mjs';

const maxIndex = process.argv.indexOf('--pool-max');
const poolMax = maxIndex === -1 ? undefined : Number(process.argv[maxIndex + 1]);
if (poolMax !== undefined && ![10, 30, 60].includes(poolMax)) throw new Error('Experiment pool max must be 10, 30 or 60');
const fixture = await createPerformanceFixture({ poolMax });
const metrics = instrumentPool(fixture.pool);
const port = Number(process.env.PERF_PORT ?? 3101);
const url = `http://127.0.0.1:${port}`;
const server = createApp(fixture.pool, { origin: url, secureCookies: false }).listen(port, '127.0.0.1');
try { await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); }); }
catch (error) { metrics.close(); await fixture.close(); throw error; }
const settings = {};
for (const setting of ['server_version', 'max_connections', 'shared_buffers', 'synchronous_commit', 'fsync', 'full_page_writes', 'transaction_isolation']) {
    settings[setting] = (await fixture.pool.query(`SHOW ${setting}`)).rows[0][setting];
}
const numberStrategy = (await fixture.pool.query("SELECT to_regclass('execution_no_seq') IS NOT NULL AS sequence")).rows[0].sequence ? 'sequence' : 'counter';
process.send({ event: 'ready', url, schema: fixture.schema, applicationName: fixture.applicationName, pid: process.pid, poolMax: fixture.pool.options.max, numberStrategy, settings });
let closing = false;
async function close() {
    if (closing) return; closing = true; metrics.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve)); await fixture.close(); process.exit(0);
}
process.on('message', async message => {
    try {
        let result;
        if (message.method === 'fixture') result = await setupWorkload(fixture, message.input);
        else if (message.method === 'stabilize') { await fixture.pool.query('ANALYZE campaigns'); await fixture.pool.query('ANALYZE executions'); result = true; }
        else if (message.method === 'start') { metrics.start(); result = true; }
        else if (message.method === 'stop') result = metrics.stop();
        else if (message.method === 'validate') result = await validateWorkload(fixture, message.input.scenario, message.input.count);
        else if (message.method === 'close') { await close(); return; }
        else throw new Error('Unknown control message');
        process.send({ id: message.id, result });
    } catch (error) { process.send({ id: message.id, error: String(error.stack) }); }
});
process.on('SIGINT', () => { void close(); });
process.on('SIGTERM', () => { void close(); });
process.on('disconnect', () => { void close(); });
