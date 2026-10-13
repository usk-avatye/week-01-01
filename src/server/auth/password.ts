import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const derive = (password: string, salt: Buffer): Promise<Buffer> => new Promise((resolve, reject) => {
    scrypt(password, salt, 64, options, (error, key) => error ? reject(error) : resolve(key));
});
export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await derive(password, salt);
    return `scrypt$32768$8$3$${salt.toString('hex')}$${key.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
    const [algorithm, n, r, p, salt, key, extra] = encoded.split('$');
    if (algorithm !== 'scrypt' || n !== '32768' || r !== '8' || p !== '3' || extra !== undefined ||
        !salt || !/^[a-f0-9]{32}$/.test(salt) || !key || !/^[a-f0-9]{128}$/.test(key))
        return false;
    const actual = await derive(password, Buffer.from(salt, 'hex'));
    return timingSafeEqual(actual, Buffer.from(key, 'hex'));
}
