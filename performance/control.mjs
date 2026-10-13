import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

export async function startServer() {
    const child = fork(fileURLToPath(new URL('./server.mjs', import.meta.url)), [], { execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const logs = [], pending = new Map();
    let number = 0;
    child.stdout.on('data', data => logs.push(String(data)));
    child.stderr.on('data', data => logs.push(String(data)));
    const ready = new Promise((resolve, reject) => {
        child.on('message', message => {
            if (message.event === 'ready') resolve(message);
            const request = pending.get(message.id);
            if (request) { pending.delete(message.id); message.error ? request.reject(new Error(message.error)) : request.resolve(message.result); }
        });
        child.on('error', reject);
        child.on('exit', (code, signal) => {
            const error = new Error(`API process ended (${code ?? signal}): ${logs.join('')}`);
            reject(error); for (const request of pending.values()) request.reject(error); pending.clear();
        });
    });
    return { child, info: await ready, logs, call(method, input) {
        return new Promise((resolve, reject) => { const id = ++number; pending.set(id, { resolve, reject }); child.send({ id, method, input }); });
    }, async close() {
        if (child.exitCode !== null) return;
        const closed = once(child, 'exit'); child.send({ id: ++number, method: 'close' }); await closed;
    } };
}
