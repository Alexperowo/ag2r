import assert from 'node:assert/strict';
import test from 'node:test';

process.env.APP_PASSWORD = 'test-password';
const { parseCookies, secureEqual } = await import('../src/utils.js');

test('parseCookies handles encoded values and equals signs', () => {
  assert.deepEqual(parseCookies('first=hello%20world; token=a=b=c'), {
    first: 'hello world',
    token: 'a=b=c',
  });
});

test('parseCookies ignores malformed values without throwing', () => {
  assert.deepEqual(parseCookies('valid=yes; broken=%E0%A4%A'), { valid: 'yes' });
  assert.deepEqual(parseCookies(undefined), {});
});

test('secureEqual compares values without type surprises', () => {
  assert.equal(secureEqual('same', 'same'), true);
  assert.equal(secureEqual('same', 'different'), false);
  assert.equal(secureEqual(undefined, ''), false);
});
