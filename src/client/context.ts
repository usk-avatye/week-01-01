import type { MemberDto } from '../contracts/auth.js';
import type { Api } from './api.js';
export interface PageContext {
    member: MemberDto;
    api: Api;
    signal: AbortSignal;
}
