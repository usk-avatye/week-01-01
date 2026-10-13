import type { Pool } from 'pg';
import type { MemberDto, Role } from '../../contracts/auth.js';
export interface MemberRow {
    id: string;
    email: string;
    password_hash: string;
    display_name: string;
    role: Role;
}
export function memberDto(row: Omit<MemberRow, 'password_hash'>): MemberDto {
    return { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
}
export async function insertMember(pool: Pool, email: string, passwordHash: string, displayName: string): Promise<MemberDto> {
    const result = await pool.query<MemberRow>(`INSERT INTO members(email,password_hash,display_name,role) VALUES ($1,$2,$3,'ADVERTISER') RETURNING id,email,display_name,role`, [email, passwordHash, displayName]);
    return memberDto(result.rows[0]!);
}
export async function findMember(pool: Pool, email: string): Promise<MemberRow | undefined> {
    return (await pool.query<MemberRow>('SELECT id,email,password_hash,display_name,role FROM members WHERE email=$1', [email])).rows[0];
}
