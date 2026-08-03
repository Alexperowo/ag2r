import net from 'node:net';

function normalizeAddress(address = '') {
  if (address.startsWith('::ffff:')) return address.slice(7);
  return address;
}

function isLoopback(address) {
  const normalized = normalizeAddress(address);
  return normalized === '::1' || normalized === '127.0.0.1';
}

export function getClientIp(req, { trustLoopbackProxy = false } = {}) {
  const remoteAddress = normalizeAddress(req.socket?.remoteAddress || '');

  if (trustLoopbackProxy && isLoopback(remoteAddress)) {
    const forwarded = req.headers?.['x-forwarded-for'];
    const firstAddress = Array.isArray(forwarded)
      ? forwarded[0]
      : forwarded?.split(',')[0]?.trim();

    if (firstAddress && net.isIP(firstAddress)) return normalizeAddress(firstAddress);
  }

  return remoteAddress || 'unknown';
}

export class SlidingWindowRateLimiter {
  constructor({ windowMs, maxRequests }) {
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new TypeError('windowMs must be a positive number');
    }
    if (!Number.isInteger(maxRequests) || maxRequests <= 0) {
      throw new TypeError('maxRequests must be a positive integer');
    }

    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.buckets = new Map();
  }

  consume(key, now = Date.now()) {
    const cutoff = now - this.windowMs;
    const recent = (this.buckets.get(key) || []).filter(timestamp => timestamp > cutoff);

    if (recent.length >= this.maxRequests) {
      this.buckets.set(key, recent);
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1, recent[0] + this.windowMs - now),
      };
    }

    recent.push(now);
    this.buckets.set(key, recent);
    return {
      allowed: true,
      remaining: this.maxRequests - recent.length,
      retryAfterMs: 0,
    };
  }

  cleanup(now = Date.now()) {
    const cutoff = now - this.windowMs;
    for (const [key, timestamps] of this.buckets) {
      const recent = timestamps.filter(timestamp => timestamp > cutoff);
      if (recent.length === 0) this.buckets.delete(key);
      else this.buckets.set(key, recent);
    }
  }
}

export function rateLimitMiddleware(limiter, options = {}) {
  return (req, res, next) => {
    const key = getClientIp(req, options);
    const result = limiter.consume(key);

    res.set('RateLimit-Limit', String(limiter.maxRequests));
    res.set('RateLimit-Remaining', String(result.remaining));

    if (!result.allowed) {
      res.set('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    next();
  };
}
