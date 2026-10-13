import { ApiError } from './errors.js';
function invalid(message: string): never { throw new ApiError(400, 'INVALID_INPUT', message); }
export function parseAmount(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1000000000) {
        invalid('금액은 1원 이상 10억 원 이하의 정수여야 합니다.');
    }
    return value;
}
export function parseId(value: unknown): string {
    if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) {
        invalid('식별자가 올바르지 않습니다.');
    }
    return value;
}
export function bodyFields(value: unknown, allowed: readonly string[]): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        invalid('입력 형식이 올바르지 않습니다.');
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some(key => !allowed.includes(key)))
        invalid('허용되지 않은 입력 항목입니다.');
    return record;
}
export function parseName(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 100)
        invalid('이름은 1~100자로 입력해 주세요.');
    return value.trim();
}
export function parsePage(value: unknown): number {
    if (value === undefined)
        return 1;
    if (typeof value !== 'string' || !/^[1-9]\d{0,5}$/.test(value))
        invalid('페이지 번호가 올바르지 않습니다.');
    return Number(value);
}
