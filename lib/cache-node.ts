// Server-only — Node.js / Docker cache adapter backed by ioredis.
// Never import from client components or files with "use client".
import Redis from "ioredis";
import type { CacheAdapter } from "@/lib/cache";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
  lazyConnect: true,
});

redis.on("error", (err: Error) => console.error("[redis]", err.message));

const adapter: CacheAdapter = {
  async get(key) {
    return redis.get(key);
  },

  async set(key, value, ttlSeconds) {
    if (ttlSeconds == null) {
      await redis.set(key, value);
    } else {
      await redis.set(key, value, "EX", ttlSeconds);
    }
  },

  async persist(key) {
    await redis.persist(key);
  },

  async del(...keys) {
    if (keys.length > 0) await redis.del(...keys);
  },

  async recordMatchAccess(key) {
    const now = Math.floor(Date.now() / 1000);
    const pipeline = redis.pipeline();
    pipeline.zadd("popular:matches:seen", now, key);
    pipeline.zincrby("popular:matches:hits", 1, key);
    await pipeline.exec();
  },

  async getPopularKeys(maxAgeSeconds, limit) {
    const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;

    // Prune entries that haven't been seen within the window.
    await redis.zremrangebyscore("popular:matches:seen", "-inf", cutoff);

    // Fetch all keys that were seen within the window.
    const recentKeys = await redis.zrangebyscore(
      "popular:matches:seen",
      cutoff,
      "+inf",
    );

    if (recentKeys.length === 0) return [];

    // Look up hit counts for each recent key.
    const pipeline = redis.pipeline();
    for (const key of recentKeys) {
      pipeline.zscore("popular:matches:hits", key);
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
