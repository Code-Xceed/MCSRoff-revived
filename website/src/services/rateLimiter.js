'use strict';

function createRateLimiter() {
  const buckets = new Map();

  function getBucket(bucketKey, now) {
    const current = buckets.get(bucketKey);
    if (!current || current.resetAt <= now) {
      const fresh = {
        count: 0,
        resetAt: now
      };
      buckets.set(bucketKey, fresh);
      return fresh;
    }
    return current;
  }

  function evaluate(bucketKey, limit, windowMs, now) {
    const bucket = getBucket(bucketKey, now);
    if (bucket.resetAt <= now) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    } else if (!bucket.resetAt || bucket.resetAt === now) {
      bucket.resetAt = now + windowMs;
    }

    bucket.count += 1;
    const remaining = Math.max(0, limit - bucket.count);
    return {
      allowed: bucket.count <= limit,
      limit,
      remaining,
      resetAt: bucket.resetAt
    };
  }

  function prune(now) {
    for (const [bucketKey, bucket] of buckets.entries()) {
      if (!bucket || bucket.resetAt <= now) {
        buckets.delete(bucketKey);
      }
    }
  }

  function applyHeaders(response, result) {
    response.setHeader('X-RateLimit-Limit', String(result.limit));
    response.setHeader('X-RateLimit-Remaining', String(result.remaining));
    response.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
    if (!result.allowed) {
      const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
      response.setHeader('Retry-After', String(retryAfter));
    }
  }

  return {
    evaluate,
    prune,
    applyHeaders
  };
}

module.exports = {
  createRateLimiter
};
