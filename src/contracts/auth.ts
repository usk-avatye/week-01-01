export type Role = 'ADVERTISER' | 'ADMIN';
export interface MemberDto {
    id: string;
    email: string;
    displayName: string;
    role: Role;
}
export interface AuthDto {
    member: MemberDto;
    csrfToken: string;
}
