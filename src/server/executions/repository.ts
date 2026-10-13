import type { ExecutionDecision, ExecutionDto, ExecutionStatus, RejectionReason } from '../../contracts/executions.js';
import type { Page } from '../../contracts/campaigns.js';
import type { Queryable } from '../db/pool.js';
import { PAGE_SIZE, pageOffset, toPage } from '../db/pagination.js';
import { notFound } from '../http/errors.js';
interface ExecutionRow {
    campaign_id: string;
    execution_no: string;
    status: ExecutionStatus;
    requested_amount: string | null;
    approved_amount: string;
    rejection_reason: RejectionReason | null;
    created_at: Date;
    processed_at: Date | null;
}
export function executionDto(row: ExecutionRow): ExecutionDto {
    return {
        campaignId: row.campaign_id, requestId: row.execution_no, status: row.status,
        requestedAmount: row.requested_amount === null ? null : Number(row.requested_amount),
        approvedAmount: Number(row.approved_amount), rejectionReason: row.rejection_reason,
        createdAt: row.created_at.toISOString(), processedAt: row.processed_at?.toISOString() ?? null,
    };
}
export async function nextExecutionNumber(db: Queryable, campaignId: string): Promise<string> {
    const result = await db.query<{
        last_execution_no: string;
    }>('UPDATE campaigns SET last_execution_no=last_execution_no+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING last_execution_no', [campaignId]);
    return result.rows[0]!.last_execution_no;
}
export async function insertPreparation(db: Queryable, campaignId: string, number: string): Promise<ExecutionDto> {
    const result = await db.query<ExecutionRow>('INSERT INTO executions(campaign_id,execution_no) VALUES ($1,$2) RETURNING *', [campaignId, number]);
    return executionDto(result.rows[0]!);
}
export async function lockExecution(db: Queryable, campaignId: string, number: string): Promise<ExecutionRow> {
    const row = (await db.query<ExecutionRow>('SELECT * FROM executions WHERE campaign_id=$1 AND execution_no=$2 FOR UPDATE', [campaignId, number])).rows[0];
    if (!row)
        throw notFound();
    return row;
}
export async function findExecution(db: Queryable, campaignId: string, number: string): Promise<ExecutionDto> {
    const row = (await db.query<ExecutionRow>('SELECT * FROM executions WHERE campaign_id=$1 AND execution_no=$2', [campaignId, number])).rows[0];
    if (!row)
        throw notFound();
    return executionDto(row);
}
export async function debitCampaign(db: Queryable, campaignId: string, amount: number): Promise<void> {
    const result = await db.query(`UPDATE campaigns SET spent_amount=spent_amount+$2,updated_at=clock_timestamp()
    WHERE id=$1 AND status='ACTIVE' AND spent_amount <= total_budget-$2`, [campaignId, amount]);
    if (result.rowCount !== 1)
        throw new Error('Campaign balance changed inside locked transaction');
}
export async function finishExecution(db: Queryable, campaignId: string, number: string, amount: number, decision: ExecutionDecision): Promise<ExecutionDto> {
    const result = await db.query<ExecutionRow>(`UPDATE executions SET status=$3,requested_amount=$4,approved_amount=$5,rejection_reason=$6,processed_at=clock_timestamp()
    WHERE campaign_id=$1 AND execution_no=$2 AND status='PREPARED' RETURNING *`, [campaignId, number, decision.status, amount, decision.approvedAmount, decision.rejectionReason]);
    if (!result.rows[0])
        throw new Error('Execution changed inside locked transaction');
    return executionDto(result.rows[0]);
}
export async function listExecutions(db: Queryable, campaignId: string, page: number, prepared: boolean): Promise<Page<ExecutionDto>> {
    const condition = prepared ? "status='PREPARED'" : "status IN ('APPROVED','REJECTED')";
    const order = prepared ? 'created_at' : 'processed_at';
    const result = await db.query<ExecutionRow>(`SELECT * FROM executions WHERE campaign_id=$1 AND ${condition} ORDER BY ${order} DESC,execution_no DESC LIMIT $2 OFFSET $3`, [campaignId, PAGE_SIZE + 1, pageOffset(page)]);
    return toPage(result.rows.map(executionDto), page);
}
