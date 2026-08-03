import assert from 'node:assert/strict';
import test from 'node:test';

import { getClientIp, SlidingWindowRateLimiter } from '../src/security.js';

test('rate limiter blocks requests inside the window and recovers afterward', () => {
  const limiter = new SlidingWindowRateLimiter({ windowMs: 1000, maxRequests: 2 });

  assert.equal(limiter.consume('client', 1000).allowed, true);
  assert.equal(limiter.consume('client', 1100).allowed, true);
  assert.equal(limiter.consume('client', 1200).allowed, false);
  assert.equal(limiter.consume('client', 2101).allowed, true);
});

test('cleanup removes expired buckets', () => {
  const limiter = new SlidingWindowRateLimiter({ windowMs: 1000, maxRequests: 2 });
  limiter.consume('client', 1000);
  limiter.cleanup(2001);
  assert.equal(limiter.buckets.size, 0);
});

test('forwarded IP is trusted only from a loopback proxy', () => {
  const proxiedRequest = {
    socket: { remoteAddress: '::1' },
    headers: { 'x-forwarded-for': '203.0.113.10, 127.0.0.1' },
  };
  const directRequest = {
    socket: { remoteAddress: '192.168.1.25' },
    headers: { 'x-forwarded-for': '203.0.113.10' },
  };

  assert.equal(getClientIp(proxiedRequest, { trustLoopbackProxy: true }), '203.0.113.10');
  assert.equal(getClientIp(directRequest, { trustLoopbackProxy: true }), '192.168.1.25');
});
