import type { MemberDto } from '../../contracts/auth.js';
export interface SessionActor {
    member: MemberDto;
    csrfToken: string;
    tokenHash: string;
}
declare global {
    namespace Express {
        interface Request {
            actor?: SessionActor;
        }
    }
}
