import assert from 'node:assert/strict';

export function poolSchedule(repeats = 3, scenarios = ['C', 'D'], poolSizes = [10, 30, 60]) {
    assert.ok(Number.isInteger(repeats) && repeats > 0);
    assert.ok(scenarios.length > 0 && scenarios.every(value => ['C', 'D'].includes(value)));
    assert.ok(poolSizes.length > 0 && poolSizes.every(value => [10, 30, 60].includes(value)));
    assert.equal(new Set(scenarios).size, scenarios.length);
    assert.equal(new Set(poolSizes).size, poolSizes.length);
    const first = [['C', 10], ['D', 30], ['C', 60], ['D', 10], ['C', 30], ['D', 60]];
    const result = [];
    for (let repeat = 1; repeat <= repeats; repeat++) {
        const offset = ((repeat - 1) * 4) % 6;
        const round = [...first.slice(offset), ...first.slice(0, offset)].filter(([scenario, poolMax]) => scenarios.includes(scenario) && poolSizes.includes(poolMax));
        round.forEach(([scenario, poolMax], position) => result.push({ scenario, poolMax, concurrency: 60,
            repeat, position: position + 1, caseId: `${scenario}-p${poolMax}-c60-r${repeat}` }));
    }
    return result;
}

export function preparationComparisonSchedule(repeats = 3) {
    assert.ok(Number.isInteger(repeats) && repeats > 0);
    return Array.from({ length: repeats }, (_, index) => (index % 2 ? ['sequence', 'counter'] : ['counter', 'sequence'])
        .map((variant, position) => ({ variant, repeat: index + 1, position: position + 1 }))).flat();
}
