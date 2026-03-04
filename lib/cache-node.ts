// Server-only — Node.js / Docker cache adapter backed by ioredis.
// Never import from client components or files with "use client".
import Redis from "ioredis";
import type { CacheAdapter } from "@/lib/cache";
import { MAX_SHOOTER_MATCHES } from "@/lib/constants";

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

  async recordMatchAccess(key) {
    const now = Math.floor(Date.now() / 1000);
    const pipeline = redis.pipeline();
    pipeline.zadd(pk("popular:matches:seen"), now, key);
    pipeline.zincrby(pk("popular:matches:hits"), 1, key);
    await pipeline.exec();
  },

  async indexShooterMatch(shooterId, matchRef, startTimestamp) {
    const key = pk(`shooter:${shooterId}:matches`);
    const p = redis.pipeline();
    p.zadd(key, startTimestamp, matchRef);
    p.zcard(key);
    const res = await p.exec();
    const count = (res?.[1]?.[1] as number) ?? 0;
    if (count > MAX_SHOOTER_MATCHES) {
      await redis.zremrangebyrank(key, 0, count - MAX_SHOOTER_MATCHES - 1);
    }
  },

  async setShooterProfile(shooterId, profile) {
    await redis.set(pk(`shooter:${shooterId}:profile`), profile);
  },

  async getShooterMatches(shooterId) {
    return redis.zrange(pk(`shooter:${shooterId}:matches`), 0, -1);
  },

  async getShooterProfile(shooterId) {
    return redis.get(pk(`shooter:${shooterId}:profile`));
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

  async getPopularKeys(maxAgeSeconds, limit) {
    const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;

    // Prune entries that haven't been seen within the window.
    await redis.zremrangebyscore(pk("popular:matches:seen"), "-inf", cutoff);

    // Fetch all keys that were seen within the window.
    const recentKeys = await redis.zrangebyscore(
      pk("popular:matches:seen"),
      cutoff,
      "+inf",
    );

    // Prune hits: remove members no longer present in seen.
    const allHitMembers = await redis.zrange(pk("popular:matches:hits"), 0, -1);
    if (allHitMembers.length > 0) {
      const aliveSet = new Set(recentKeys);
      const stale = allHitMembers.filter((m) => !aliveSet.has(m));
      if (stale.length > 0) {
        await redis.zrem(pk("popular:matches:hits"), ...stale);
      }
    }

    if (recentKeys.length === 0) return [];

    // Look up hit counts for each recent key.
    const pipeline = redis.pipeline();
    for (const key of recentKeys) {
      pipeline.zscore(pk("popular:matches:hits"), key);
    }
    const scores = await pipeline.exec();

    const results = recentKeys.map((key, i) => {
      const raw = scores?.[i]?.[1];
      const hits = typeof raw === "string" ? parseFloat(raw) : (raw as number | null) ?? 0;
      return { key, hits: isNaN(hits) ? 0 : Math.round(hits) };
    });

    return results.sort((a, b) => b.hits - a.hits).slice(0, limit);
  },
};

export default adapter;
