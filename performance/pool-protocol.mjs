import assert from 'node:assert/strict';

export function poolSchedule(repeats = 3) {
    assert.ok(Number.isInteger(repeats) && repeats > 0);
    const first = [['C', 10], ['D', 30], ['C', 60], ['D', 10], ['C', 30], ['D', 60]];
    const result = [];
    for (let repeat = 1; repeat <= repeats; repeat++) {
        const offset = ((repeat - 1) * 4) % 6;
        const round = [...first.slice(offset), ...first.slice(0, offset)];
        round.forEach(([scenario, poolMax], position) => result.push({ scenario, poolMax, concurrency: 60,
            repeat, position: position + 1, caseId: `${scenario}-p${poolMax}-c60-r${repeat}` }));
    }
    return result;
}
