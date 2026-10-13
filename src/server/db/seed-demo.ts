import type { Pool } from 'pg';
import { hashPassword } from '../auth/password.js';
import { withTransaction } from './transaction.js';
import { normalizeDemoText } from './normalize-demo-text.js';
import { demoCampaigns, seedCampaigns } from './seed-campaigns.js';
const accounts = [
    { email: 'admin@example.test', name: '운영 관리자', role: 'ADMIN' },
    { email: 'advertiser-a@example.test', name: '모노픽셀', role: 'ADVERTISER', previousName: '광고주 A' },
    { email: 'advertiser-b@example.test', name: '누크리빙', role: 'ADVERTISER', previousName: '광고주 B' },
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
            if ('previousName' in account) {
                await client.query('UPDATE members SET display_name=$2 WHERE id=$1 AND display_name=$3', [member.id, account.name, account.previousName]);
                await seedCampaigns(client, member.id, demoCampaigns[account.email]);
            }
        }
    });
}
