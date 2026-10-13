import type { Pool } from 'pg';
import type { MemberRow } from './member-repository.js';
export interface SessionRow extends Omit<MemberRow, 'password_hash'> {
    token_hash: string;
    csrf_token: string;
    expires_at: Date;
}
export async function insertSession(pool: Pool, tokenHash: string, memberId: string, csrfToken: string, createdAt: Date, expiresAt: Date): Promise<void> {
    await pool.query('INSERT INTO sessions(token_hash,member_id,csrf_token,created_at,expires_at) VALUES ($1,$2,$3,$4,$5)', [tokenHash, memberId, csrfToken, createdAt, expiresAt]);
}
export async function findSession(pool: Pool, tokenHash: string): Promise<SessionRow | undefined> {
    return (await pool.query<SessionRow>(`SELECT m.id,m.email,m.display_name,m.role,s.token_hash,s.csrf_token,s.expires_at
     FROM sessions s JOIN members m ON m.id=s.member_id WHERE s.token_hash=$1`, [tokenHash])).rows[0];
}
export async function deleteSession(pool: Pool, tokenHash: string): Promise<void> {
    await pool.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash]);
}
