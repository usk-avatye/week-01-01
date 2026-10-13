import assert from 'node:assert/strict';
import test from 'node:test';
import { requireTestDatabase } from './fixture.mjs';

test('destructive performance fixtures reject service databases and missing configuration', () => {
    assert.throws(() => requireTestDatabase(undefined));
    assert.throws(() => requireTestDatabase('postgresql://localhost/campaign_guard'));
    assert.throws(() => requireTestDatabase('postgresql://localhost/campaign_guard_test_backup'));
    assert.equal(requireTestDatabase('postgresql://localhost/campaign_guard_test'), 'postgresql://localhost/campaign_guard_test');
});
