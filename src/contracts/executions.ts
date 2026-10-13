export type RejectionReason = 'CAMPAIGN_PAUSED' | 'INSUFFICIENT_BUDGET';
export type ExecutionStatus = 'PREPARED' | 'APPROVED' | 'REJECTED';
export interface ExecutionDto {
    campaignId: string;
    requestId: string;
    status: ExecutionStatus;
    requestedAmount: number | null;
    approvedAmount: number;
    rejectionReason: RejectionReason | null;
    createdAt: string;
    processedAt: string | null;
}
export interface ExecutionDecision {
    status: 'APPROVED' | 'REJECTED';
    approvedAmount: number;
    rejectionReason: RejectionReason | null;
}
