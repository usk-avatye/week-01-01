import { el } from './dom.js';

export function budgetUsage(spent: number, budget: number): HTMLElement {
    const percent = Math.min(100, Math.max(0, spent / budget * 100));
    const box = el('div', '', `budget-usage${percent >= 100 ? ' exhausted' : percent >= 90 ? ' near-limit' : ''}`);
    const meter = el('meter');
    meter.min = 0;
    meter.max = budget;
    meter.value = spent;
    meter.setAttribute('aria-label', '예산 사용률');
    const value = el('span', `${percent.toFixed(1)}%`, 'numeric');
    box.append(meter, value);
    return box;
}
