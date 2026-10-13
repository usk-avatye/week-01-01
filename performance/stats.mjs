export function percentile(values, quantile) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)];
}
export function describeWaits(values) {
    return { count: values.length, p50Ms: percentile(values, .5), p95Ms: percentile(values, .95),
        p99Ms: percentile(values, .99), maxMs: values.length ? Math.max(...values) : 0 };
}
export function summarize(requests, elapsedMs) {
    if (!requests.length || !Number.isFinite(elapsedMs) || elapsedMs <= 0) throw new Error('No valid measurement');
    const durations = requests.map(row => row.latencyMs);
    if (durations.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid request latency');
    const errors = requests.filter(row => row.error).length;
    return { requests: requests.length, errors, elapsedMs, rps: requests.length * 1000 / elapsedMs,
        successfulRps: (requests.length - errors) * 1000 / elapsedMs, errorRate: errors / requests.length,
        p50Ms: percentile(durations, .5), p95Ms: percentile(durations, .95), p99Ms: percentile(durations, .99) };
}
