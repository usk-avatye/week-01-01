import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baselineDirectory = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Pass the directory containing the built baseline checkout and the same performance harness');
const currentDirectory = process.cwd();
assert.notEqual(baselineDirectory, currentDirectory);
for (const [scenario, concurrency] of [['A', 1], ['B', 10], ['A', 30], ['D', 30]]) {
    const suffix = `${scenario.toLowerCase()}${concurrency}`;
    for (const [variant, directory] of [['base', baselineDirectory], ['sequence', currentDirectory]]) {
        const label = `confirm-${variant}-${suffix}`;
        await new Promise((done, fail) => {
            const child = spawn(process.execPath, ['--env-file=.env', 'performance/runner.mjs', '--label', label,
                '--scenarios', scenario, '--concurrency', String(concurrency), '--operations', '12000', '--warmup', '2000', '--repeats', '3'],
            { cwd: directory, stdio: 'inherit' });
            child.once('error', fail); child.once('exit', code => code === 0 ? done() : fail(new Error(`${label}: exit ${code}`)));
        });
        if (variant === 'base') {
            const source = `${directory}/performance/results/${label}`;
            const manifest = JSON.parse(await readFile(`${source}/manifest.json`));
            assert.equal(manifest.gitHead, 'd8664e2b89873ed979acbb32b486c3d00571ef7c');
            await cp(source, `${currentDirectory}/performance/results/${label}`, { recursive: true, errorOnExist: true, force: false });
        }
    }
}
