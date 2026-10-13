import type { Pool } from 'pg';
import { hashPassword } from '../auth/password.js';
import { withTransaction } from './transaction.js';
import { normalizeDemoText } from './normalize-demo-text.js';
const accounts = [
    { email: 'admin@example.test', name: '운영 관리자', role: 'ADMIN', campaign: null },
    { email: 'advertiser-a@example.test', name: '광고주 A', role: 'ADVERTISER', campaign: '신제품 런칭' },
    { email: 'advertiser-b@example.test', name: '광고주 B', role: 'ADVERTISER', campaign: '브랜드 인지도' },
] as const;
export async function seedDemo(pool: Pool, password: string): Promise<void> {
    if ([...password].length < 15 || [...password].length > 128 || Buffer.byteLength(password) > 1024)
        throw new Error('DEMO_PASSWORD must contain 15–128 characters');
    const hashes = await Promise.all(accounts.map(() => hashPassword(password)));
    await withTransaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(84190273)');
        await normalizeDemoText(client);
        for (const [index, account] of accounts.entries()) {
            await client.query(`INSERT INTO members(email,password_hash,display_name,role) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING`, [account.email, hashes[index], account.name, account.role]);
            const member = (await client.query<{
                id: string;
                role: string;
            }>('SELECT id,role FROM members WHERE email=$1', [account.email])).rows[0]!;
            if (member.role !== account.role)
                throw new Error('A demo email already belongs to another role; seed refuses to promote or replace it');
            if (account.campaign)
                await client.query(`INSERT INTO campaigns(owner_id,name,total_budget)
        SELECT $1,$2,10000 WHERE NOT EXISTS(SELECT 1 FROM campaigns WHERE owner_id=$1 AND name=$2)`, [member.id, account.campaign]);
        }
    });
}
