// Server-only — Node.js / Docker cache adapter backed by ioredis.
// Never import from client components or files with "use client".
import Redis from "ioredis";
import type { CacheAdapter } from "@/lib/cache";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
  lazyConnect: true,
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

const adapter: CacheAdapter = {
  async get(key) {
    return redis.get(pk(key));
  },

  async set(key, value, ttlSeconds) {
    if (ttlSeconds == null) {
      await redis.set(pk(key), value);
    } else {
      await redis.set(pk(key), value, "EX", ttlSeconds);
    }
  },

  async persist(key) {
    await redis.persist(pk(key));
  },

  async del(...keys) {
    if (keys.length > 0) await redis.del(...keys.map(pk));
  },

  async expire(key, ttlSeconds) {
    await redis.expire(pk(key), ttlSeconds);
  },

  async setIfAbsent(key, value, ttlSeconds) {
    const res = await redis.set(pk(key), value, "EX", ttlSeconds, "NX");
    return res === "OK";
  },

  async scanCachedMatchKeys() {
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
