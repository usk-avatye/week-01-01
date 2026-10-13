export interface AppConfig {
    origin: string;
    secureCookies: boolean;
}
export function readConfig(): AppConfig & {
    port: number;
    databaseUrl: string;
} {
    const port = Number(process.env.PORT ?? 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error('Invalid PORT');
    const origin = process.env.APP_ORIGIN ?? `http://localhost:${port}`;
    const parsed = new URL(origin);
    if (parsed.origin !== origin)
        throw new Error('APP_ORIGIN must contain only the origin');
    if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:')
        throw new Error('Production requires an HTTPS origin');
    if (!process.env.DATABASE_URL)
        throw new Error('DATABASE_URL is required');
    return { port, origin, secureCookies: parsed.protocol === 'https:', databaseUrl: process.env.DATABASE_URL };
}
