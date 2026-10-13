import pg from 'pg';
export function createDatabasePool(connectionString: string, max = 10): pg.Pool {
    if (!Number.isInteger(max) || max < 1) throw new RangeError('Pool max must be a positive integer');
    const pool = new pg.Pool({ connectionString, max, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000 });
    pool.on('error', () => console.error('An idle database connection failed.'));
    return pool;
}
export type Queryable = Pick<pg.PoolClient, 'query'>;
