import { createApp } from './app.js';
import { readConfig } from './config.js';
import { createDatabasePool } from './db/pool.js';
const config = readConfig(), pool = createDatabasePool(config.databaseUrl);
await pool.query('SELECT 1');
const server = createApp(pool, config).listen(config.port, '127.0.0.1', () => {
    console.log(`Campaign Budget Guard: ${config.origin}`);
});
const stop = () => {
    server.close(() => { void pool.end().then(() => process.exit(0)); });
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
