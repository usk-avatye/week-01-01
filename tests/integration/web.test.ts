import assert from 'node:assert/strict';
import test from 'node:test';
import { createHttpFixture } from '../support/http.js';
test('browser entry is HTML while an unknown API keeps a JSON 404 contract', async (t) => {
    const f = await createHttpFixture();
    t.after(() => f.close());
    const page = await fetch(f.url + '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    const missing = await fetch(f.url + '/api/unknown');
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get('content-type') ?? '', /application\/json/);
});
