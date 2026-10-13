import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, verifyPassword } from '../../src/server/auth/password.js';
test('salted password hashes verify Unicode passwords and reject incorrect input', async () => {
    const password = '광고주-안전한-비밀번호-2026!';
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    assert.notEqual(first, password);
    assert.notEqual(first, second);
    assert.equal(await verifyPassword(password, first), true);
    assert.equal(await verifyPassword('wrong password', first), false);
    assert.equal(await verifyPassword(password, 'corrupt-hash'), false);
});
