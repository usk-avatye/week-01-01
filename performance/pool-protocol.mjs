import assert from 'node:assert/strict';

export function poolSchedule(repeats = 3, scenarios = ['C', 'D'], poolSizes = [10, 30, 60], concurrencies = [60]) {
    assert.ok(Number.isInteger(repeats) && repeats > 0);
    assert.ok(scenarios.length > 0 && scenarios.every(value => ['B', 'C', 'D'].includes(value)));
    assert.ok(poolSizes.length > 0 && poolSizes.every(value => [10, 30, 60].includes(value)));
    assert.equal(new Set(scenarios).size, scenarios.length);
    assert.equal(new Set(poolSizes).size, poolSizes.length);
    assert.ok(concurrencies.length > 0 && concurrencies.every(value => [1, 10, 30, 60].includes(value)));
    assert.equal(new Set(concurrencies).size, concurrencies.length);
    const historical = !scenarios.includes('B') && concurrencies.length === 1 && concurrencies[0] === 60;
    const first = historical ? [['C', 10, 60], ['D', 30, 60], ['C', 60, 60], ['D', 10, 60], ['C', 30, 60], ['D', 60, 60]]
        : concurrencies.flatMap((_, at) => poolSizes.flatMap((poolMax, poolAt) => scenarios
            .map(scenario => [scenario, poolMax, concurrencies[(at + poolAt) % concurrencies.length]])));
    const result = [];
    for (let repeat = 1; repeat <= repeats; repeat++) {
        const offset = ((repeat - 1) * (historical ? 4 : 1)) % first.length;
        const round = [...first.slice(offset), ...first.slice(0, offset)].filter(([scenario, poolMax]) => scenarios.includes(scenario) && poolSizes.includes(poolMax));
        round.forEach(([scenario, poolMax, concurrency], position) => result.push({ scenario, poolMax, concurrency,
            repeat, position: position + 1, caseId: `${scenario}-p${poolMax}-c${concurrency}-r${repeat}` }));
    }
    return result;
}

export function preparationComparisonSchedule(repeats = 3) {
    assert.ok(Number.isInteger(repeats) && repeats > 0);
    return Array.from({ length: repeats }, (_, index) => (index % 2 ? ['sequence', 'counter'] : ['counter', 'sequence'])
        .map((variant, position) => ({ variant, repeat: index + 1, position: position + 1 }))).flat();
}
