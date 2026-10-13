import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { textElement } from '../../src/client/dom.js';
test('member and campaign text is rendered literally instead of as HTML', () => {
    const document = new JSDOM('').window.document;
    const value = '<img src=x onerror=alert(1)><script>alert(1)</script>';
    const node = textElement(document, 'p', value);
    assert.equal(node.textContent, value);
    assert.equal(node.querySelector('img'), null);
    assert.equal(node.querySelector('script'), null);
});
