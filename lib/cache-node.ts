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

  async scanRecentKeys(prefix, maxIdleSeconds) {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [nextCursor, batch] = await redis.scan(
        cursor,
        "MATCH",
        `${prefix}*`,
        "COUNT",
        100,
      );
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== "0");

    const results = await Promise.all(
      keys.map(async (key): Promise<{ key: string; idleSeconds: number }> => {
        try {
          const result = await redis.object("IDLETIME", key);
          const idleSeconds = typeof result === "number" ? result : 0;
          return { key, idleSeconds };
        } catch {
          // OBJECT IDLETIME unsupported on some managed Redis configs —
          // treat as idle=0 so the entry is included.
          return { key, idleSeconds: 0 };
        }
      }),
    );

    return results
      .filter(({ idleSeconds }) => idleSeconds <= maxIdleSeconds)
      .sort((a, b) => a.idleSeconds - b.idleSeconds);
  },
};

export default adapter;
