import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabasePool } from '../../src/server/db/pool.js';

test('database pool uses measured default ten and accepts explicit experiment limits', async () => {
    for (const max of [undefined, 10, 30, 60]) {
        const pool = createDatabasePool('postgresql://localhost/example_test', max);
        assert.equal(pool.options.max, max ?? 10);
        await pool.end();
    }
});
test('invalid pool limits fail before opening a connection', () => {
    for (const max of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => createDatabasePool('postgresql://localhost/example_test', max), RangeError);
});
