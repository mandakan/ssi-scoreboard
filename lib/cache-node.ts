// Server-only — Node.js / Docker cache adapter backed by ioredis.
// Never import from client components or files with "use client".
import Redis from "ioredis";
import type { CacheAdapter } from "@/lib/cache";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
  lazyConnect: true,
  // Cap reconnect back-off at 500ms (ioredis 6 default grows to 2s). With
  // maxRetriesPerRequest: 1 a command waits for the next reconnect attempt,
  // so an unreachable Redis must degrade to a fast cache miss, not a
  // multi-second stall per read.
  retryStrategy: (times) => Math.min(times * 50, 500),
});

redis.on("error", (err: Error) => {
  // ioredis emits error events with an empty message during connection-retry
  // back-off cycles; suppress those to avoid log spam in environments without Redis.
  if (err.message) console.error("[redis]", err.message);
});

// Prefix all Redis key names with CACHE_KEY_PREFIX (e.g. "staging:") so that
// multiple environments can safely share a single Redis instance.
// Members stored inside sorted sets are bare cache keys, not Redis key names,
// so they are not prefixed — callers receive them as-is.
const PREFIX = process.env.CACHE_KEY_PREFIX ?? "";
const pk = (key: string) => `${PREFIX}${key}`;

// Fail fast while Redis is known to be down. With the offline queue enabled
// (needed so the lazy first connection can buffer commands), a command sent
// while ioredis waits out its reconnect back-off sits in that queue until the
// next attempt fails -- up to 500ms each. A match-page render chains several
// cache reads, so an unreachable Redis turned into multi-second stalls
// instead of the cheap cache miss the retry settings above intend. The
// statuses below are only reached after a connection has been lost or a
// connect attempt has failed; "wait"/"connecting"/"connect"/"ready" pass
// through so cold starts still connect normally.
const UNAVAILABLE_STATUSES = new Set(["reconnecting", "close", "end"]);
function assertRedisAvailable(): void {
  if (UNAVAILABLE_STATUSES.has(redis.status)) {
    throw new Error(`Redis unavailable (status: ${redis.status})`);
  }
}

const adapter: CacheAdapter = {
  async get(key) {
    assertRedisAvailable();
    return redis.get(pk(key));
  },

  async set(key, value, ttlSeconds) {
    assertRedisAvailable();
    if (ttlSeconds == null) {
      await redis.set(pk(key), value);
    } else {
      await redis.set(pk(key), value, "EX", ttlSeconds);
    }
  },

  async persist(key) {
    assertRedisAvailable();
    await redis.persist(pk(key));
  },

  async del(...keys) {
    assertRedisAvailable();
    if (keys.length > 0) await redis.del(...keys.map(pk));
  },

  async expire(key, ttlSeconds) {
    assertRedisAvailable();
    await redis.expire(pk(key), ttlSeconds);
  },

  async setIfAbsent(key, value, ttlSeconds) {
    assertRedisAvailable();
    const res = await redis.set(pk(key), value, "EX", ttlSeconds, "NX");
    return res === "OK";
  },

  async scanCachedMatchKeys() {
    assertRedisAvailable();
    const pattern = `${PREFIX}gql:GetMatch:*`;
    const keys: string[] = [];
    const stream = redis.scanStream({ match: pattern, count: 200 });
    for await (const batch of stream) {
      for (const key of batch as string[]) {
        keys.push(key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key);
      }
    }
    return keys;
  },

};

export default adapter;
