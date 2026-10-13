import http from 'node:http';
import type { AddressInfo } from 'node:net';
export async function responseProxy(target: string, mode: 'drop' | 'delay') {
    let signalReceived!: () => void, release!: () => void;
    const received = new Promise<void>(resolve => { signalReceived = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const server = http.createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req)
            chunks.push(Buffer.from(chunk));
        signalReceived();
        if (mode === 'delay')
            await gate;
        const url = new URL(req.url ?? '/', target);
        const upstream = http.request(url, { method: req.method, headers: { ...req.headers, host: url.host, connection: 'close' } }, response => {
            const output: Buffer[] = [];
            response.on('data', chunk => output.push(Buffer.from(chunk)));
            response.on('end', () => {
                if (mode === 'drop') {
                    res.destroy();
                    return;
                }
                res.writeHead(response.statusCode ?? 502, response.headers);
                res.end(Buffer.concat(output));
            });
        });
        upstream.on('error', () => { res.writeHead(502); res.end('{}'); });
        upstream.end(Buffer.concat(chunks));
    });
    server.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    return {
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, received, release,
        async close() {
            release();
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        },
    };
}
