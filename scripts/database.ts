import { access, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
const directory = resolve('.local/postgres');
const port = Number(process.env.LOCAL_PG_PORT ?? 55432);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Invalid LOCAL_PG_PORT');
await mkdir(directory, { recursive: true });
const database = new EmbeddedPostgres({
    databaseDir: directory, port, user: 'guard', password: 'local-dev-only',
    authMethod: 'scram-sha-256', persistent: true,
    postgresFlags: ['-h', '127.0.0.1', '-k', directory],
    onLog: () => { }, onError: message => console.error(String(message)),
});
try {
    await access(resolve(directory, 'PG_VERSION'));
}
catch {
    await database.initialise();
}
await database.start();
const client = database.getPgClient('postgres', '127.0.0.1');
await client.connect();
for (const name of ['campaign_guard', 'campaign_guard_test']) {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]);
    if (!exists.rowCount)
        await client.query(`CREATE DATABASE "${name}"`);
}
const version = await client.query('SHOW server_version');
await client.end();
console.log(`PostgreSQL ${version.rows[0].server_version} ready on 127.0.0.1:${port}. Data: .local/postgres`);
let stopping = false;
const stop = async () => {
    if (stopping)
        return;
    stopping = true;
    await database.stop();
    process.exit(0);
};
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
