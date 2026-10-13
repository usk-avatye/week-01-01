export type CampaignStatus = 'ACTIVE' | 'PAUSED';
export interface CampaignDto {
    id: string;
    ownerId: string;
    name: string;
    status: CampaignStatus;
    totalBudget: number;
    spentAmount: number;
    remainingBudget: number;
    createdAt: string;
    updatedAt: string;
    ownerName?: string;
    ownerEmail?: string;
}
export interface Page<T> {
    items: T[];
    page: number;
    limit: number;
    hasNext: boolean;
}
