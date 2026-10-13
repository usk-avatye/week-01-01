import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

export async function fingerprint(directories, extension) {
    const names = execFileSync('rg', ['--files', ...directories], { encoding: 'utf8' }).trim().split('\n')
        .filter(path => !extension || path.endsWith(extension)).sort();
    const sources = [];
    for (const path of names) sources.push({ path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
    return { digest: createHash('sha256').update(JSON.stringify(sources)).digest('hex'), sources };
}
