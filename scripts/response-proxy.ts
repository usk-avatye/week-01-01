import http from 'node:http';
import type { AddressInfo } from 'node:net';

interface FirstExecutionDrop {
    dropFirstExecutionFor: ReadonlySet<string>;
    port?: number;
    onDrop?: (campaignId: string, requestId: string) => void;
}

export async function responseProxy(target: string, mode: 'drop' | 'delay' | FirstExecutionDrop) {
    const destination = new URL(target);
    let signalReceived!: () => void, release!: () => void;
    const received = new Promise<void>(resolve => { signalReceived = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const dropped = new Set<string>();
    async function forward(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const url = new URL(req.url ?? '/', destination);
        if (url.origin !== destination.origin) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 'DEMO_TARGET_FORBIDDEN', message: '시연 백엔드 주소만 사용할 수 있습니다.' } }));
            return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        signalReceived();
        if (mode === 'delay') await gate;
        const upstream = http.request(url, { method: req.method, headers: { ...req.headers, host: url.host, connection: 'close' } }, response => {
            const output: Buffer[] = [];
            response.on('data', chunk => output.push(Buffer.from(chunk)));
            response.on('error', () => res.destroy());
            response.on('end', () => {
                const match = /^\/api\/campaigns\/([1-9]\d*)\/executions\/([1-9]\d*)\/?$/.exec(url.pathname);
                if (typeof mode !== 'string' && req.method === 'POST' && response.statusCode === 200 && match &&
                    mode.dropFirstExecutionFor.has(match[1]!) && !dropped.has(match[1]!)) {
                    dropped.add(match[1]!);
                    mode.onDrop?.(match[1]!, match[2]!);
                    res.destroy();
                    return;
                }
                if (mode === 'drop') { res.destroy(); return; }
                res.writeHead(response.statusCode ?? 502, response.headers);
                res.end(Buffer.concat(output));
            });
        });
        upstream.on('error', () => {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 'DEMO_UPSTREAM_UNAVAILABLE', message: '시연 서버에 연결하지 못했습니다.' } }));
        });
        upstream.end(Buffer.concat(chunks));
    }
    const server = http.createServer((req, res) => { void forward(req, res).catch(() => res.destroy()); });
    server.listen(typeof mode === 'string' ? 0 : mode.port ?? 0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    let closing: Promise<void> | undefined;
    return {
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, received, release,
        close() {
            closing ??= (async () => {
                release();
                server.closeAllConnections();
                await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
            })();
            return closing;
        },
    };
}
