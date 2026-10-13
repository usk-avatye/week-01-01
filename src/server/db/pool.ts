import pg from 'pg';
export function createDatabasePool(connectionString: string): pg.Pool {
    const pool = new pg.Pool({ connectionString, max: 30, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000 });
    pool.on('error', () => console.error('An idle database connection failed.'));
    return pool;
}
export type Queryable = Pick<pg.PoolClient, 'query'>;
