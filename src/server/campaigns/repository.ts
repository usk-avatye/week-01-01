import type { CampaignDto, CampaignStatus, Page } from '../../contracts/campaigns.js';
import type { Queryable } from '../db/pool.js';
import { PAGE_SIZE, pageOffset, toPage } from '../db/pagination.js';
import { notFound } from '../http/errors.js';
export interface CampaignRow {
    id: string;
    owner_id: string;
    name: string;
    status: CampaignStatus;
    total_budget: string;
    spent_amount: string;
    last_execution_no: string;
    created_at: Date;
    updated_at: Date;
    owner_name?: string;
    owner_email?: string;
}
export function campaignDto(row: CampaignRow): CampaignDto {
    const dto: CampaignDto = {
        id: row.id, ownerId: row.owner_id, name: row.name, status: row.status,
        totalBudget: Number(row.total_budget), spentAmount: Number(row.spent_amount),
        remainingBudget: Number(row.total_budget) - Number(row.spent_amount),
        createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    };
    if (row.owner_name !== undefined)
        dto.ownerName = row.owner_name;
    if (row.owner_email !== undefined)
        dto.ownerEmail = row.owner_email;
    return dto;
}
export async function insertCampaign(db: Queryable, ownerId: string, name: string, totalBudget: number): Promise<CampaignDto> {
    const result = await db.query<CampaignRow>('INSERT INTO campaigns(owner_id,name,total_budget) VALUES ($1,$2,$3) RETURNING *', [ownerId, name, totalBudget]);
    return campaignDto(result.rows[0]!);
}
export async function findOwnedCampaign(db: Queryable, ownerId: string, id: string): Promise<CampaignRow> {
    const row = (await db.query<CampaignRow>('SELECT * FROM campaigns WHERE id=$1 AND owner_id=$2', [id, ownerId])).rows[0];
    if (!row)
        throw notFound();
    return row;
}
export async function lockOwnedCampaign(db: Queryable, ownerId: string, id: string): Promise<CampaignRow> {
    const row = (await db.query<CampaignRow>('SELECT * FROM campaigns WHERE id=$1 AND owner_id=$2 FOR UPDATE', [id, ownerId])).rows[0];
    if (!row)
        throw notFound();
    return row;
}
export async function listOwnedCampaigns(db: Queryable, ownerId: string, page: number): Promise<Page<CampaignDto>> {
    const result = await db.query<CampaignRow>('SELECT * FROM campaigns WHERE owner_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3', [ownerId, PAGE_SIZE + 1, pageOffset(page)]);
    return toPage(result.rows.map(campaignDto), page);
}
export async function updateBudget(db: Queryable, id: string, totalBudget: number): Promise<CampaignDto> {
    const result = await db.query<CampaignRow>('UPDATE campaigns SET total_budget=$2,updated_at=clock_timestamp() WHERE id=$1 RETURNING *', [id, totalBudget]);
    return campaignDto(result.rows[0]!);
}
export async function updateStatus(db: Queryable, id: string, status: CampaignStatus): Promise<CampaignDto> {
    const result = await db.query<CampaignRow>('UPDATE campaigns SET status=$2,updated_at=clock_timestamp() WHERE id=$1 RETURNING *', [id, status]);
    return campaignDto(result.rows[0]!);
}
