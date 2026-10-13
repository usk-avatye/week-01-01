import type { Pool } from 'pg';
import { campaignDto, type CampaignRow } from '../campaigns/repository.js';
import { listExecutions } from '../executions/repository.js';
import { PAGE_SIZE, pageOffset, toPage } from '../db/pagination.js';
import { notFound } from '../http/errors.js';
const details = `SELECT c.*,m.display_name AS owner_name,m.email AS owner_email FROM campaigns c JOIN members m ON m.id=c.owner_id`;
export function createAdminQueries(pool: Pool) {
    const get = async (id: string) => {
        const row = (await pool.query<CampaignRow>(details + ' WHERE c.id=$1', [id])).rows[0];
        if (!row)
            throw notFound();
        return campaignDto(row);
    };
    return {
        async list(page: number) {
            const result = await pool.query<CampaignRow>(details + ' ORDER BY c.created_at DESC,c.id DESC LIMIT $1 OFFSET $2', [PAGE_SIZE + 1, pageOffset(page)]);
            return toPage(result.rows.map(campaignDto), page);
        },
        get,
        async history(id: string, page: number) { await get(id); return listExecutions(pool, id, page, false); },
    };
}
export type AdminQueries = ReturnType<typeof createAdminQueries>;
