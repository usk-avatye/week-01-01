import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('confirmation reproduction uses fresh labels and preserves existing result evidence', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'guard-confirm-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const baseline = join(directory, 'baseline'), current = join(directory, 'current');
    const runner = `import {mkdir,readFile,writeFile} from 'node:fs/promises';
        const label=process.argv[process.argv.indexOf('--label')+1], path='performance/results/'+label;
        try { await readFile(path+'/manifest.json'); throw new Error('Existing evidence'); }
        catch(error) { if(error.code!=='ENOENT') throw error; }
        await mkdir(path,{recursive:true});
        await writeFile(path+'/manifest.json',JSON.stringify({gitHead:'d8664e2b89873ed979acbb32b486c3d00571ef7c'}));`;
    for (const path of [baseline, current]) {
        await mkdir(join(path, 'performance/results/confirm-base-a1'), { recursive: true });
        await writeFile(join(path, '.env'), '');
        await writeFile(join(path, 'performance/runner.mjs'), runner);
        await writeFile(join(path, 'performance/results/confirm-base-a1/manifest.json'), 'original evidence');
    }
    const result = await new Promise(resolve => {
        const child = spawn(process.execPath, [fileURLToPath(new URL('./confirm.mjs', import.meta.url)), baseline, 'reproduction'],
            { cwd: current, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = ''; child.stderr.on('data', chunk => { output += chunk; });
        child.on('exit', code => resolve({ code, output }));
    });
    assert.equal(result.code, 0, result.output);
    for (const suffix of ['a1', 'b10', 'a30', 'd30']) for (const variant of ['base', 'sequence']) {
        const content = JSON.parse(await readFile(join(current, `performance/results/reproduction-${variant}-${suffix}/manifest.json`)));
        assert.equal(content.gitHead, 'd8664e2b89873ed979acbb32b486c3d00571ef7c');
    }
    for (const path of [baseline, current]) assert.equal(await readFile(join(path, 'performance/results/confirm-base-a1/manifest.json'), 'utf8'), 'original evidence');
});
