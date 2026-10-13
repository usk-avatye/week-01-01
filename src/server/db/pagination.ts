import type { Page } from '../../contracts/campaigns.js';
export const PAGE_SIZE = 20;
export const pageOffset = (page: number) => (page - 1) * PAGE_SIZE;
export function toPage<T>(items: T[], page: number): Page<T> {
    return { items: items.slice(0, PAGE_SIZE), page, limit: PAGE_SIZE, hasNext: items.length > PAGE_SIZE };
}
