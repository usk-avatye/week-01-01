import { once } from 'node:events';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { createApp } from '../src/server/app.js';
import { createDatabasePool } from '../src/server/db/pool.js';
import { prepareRecoveryDemo } from './recovery-demo-data.js';
import { responseProxy } from './response-proxy.js';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--port')) throw new Error('사용법: npm run demo:recovery -- --port 3001');
const port = Number(args[1] ?? process.env.RECOVERY_DEMO_PORT ?? 3001);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('시연 포트는 1024~65535 사이의 정수여야 합니다.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL을 설정하세요.');
const pool = createDatabasePool(process.env.DATABASE_URL, 3);
const origin = `http://localhost:${port}`, armed = new Set<string>();
let backend: Server | undefined, proxy: Awaited<ReturnType<typeof responseProxy>> | undefined, stopping = false;
async function stop() {
    if (stopping) return;
    stopping = true;
    await proxy?.close();
    if (backend?.listening) {
        backend.closeAllConnections();
        await new Promise<void>((resolve, reject) => backend!.close(error => error ? reject(error) : resolve()));
    }
    await pool.end();
}
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
try {
    backend = createApp(pool, { origin, secureCookies: false }).listen(0, '127.0.0.1');
    await once(backend, 'listening');
    const upstream = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
    proxy = await responseProxy(upstream, {
        port, dropFirstExecutionFor: armed,
        onDrop: (campaignId, requestId) => console.log(`집행 확정 후 응답 유실: 캠페인 #${campaignId}, 요청 #${requestId}`),
    });
    const demo = await prepareRecoveryDemo(pool, origin);
    for (const scenario of demo.scenarios) armed.add(scenario.campaignId);
    const output = resolve(process.env.RECOVERY_DEMO_OUTPUT ?? '.local/recovery-demo.json');
    await mkdir(dirname(output), { recursive: true });
    const temporary = `${output}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(demo, null, 2) + '\n');
    await rename(temporary, output);
    console.log(`미확정 요청 복구 시연: ${origin}`);
    console.log(`계정: ${demo.email}`);
    for (const scenario of demo.scenarios) console.log(`${scenario.action === 'confirm' ? '결과 확인' : '다시 시도'}: ${scenario.url}`);
    console.log('각 화면에서 1,000원 집행 후 새로고침하고 해당 복구 버튼을 누르세요. 종료: Ctrl+C');
}
catch (error) {
    console.error(error instanceof Error ? error.message : '시연 서버를 시작하지 못했습니다.');
    process.exitCode = 1;
    await stop();
}
