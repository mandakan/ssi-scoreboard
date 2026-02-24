// Edge-compatible cache adapter backed by Upstash Redis (HTTP).
// Used in Cloudflare Pages builds (DEPLOY_TARGET=cloudflare).
// Never import ioredis or any Node.js-only module from this file.
import { Redis } from "@upstash/redis";
import type { CacheAdapter } from "@/lib/cache";

// automaticDeserialization: false keeps values as raw strings so callers
// can JSON.parse themselves — consistent with the ioredis adapter.
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL ?? "",
  token: process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
  automaticDeserialization: false,
});

const adapter: CacheAdapter = {
  async get(key) {
    return redis.get<string>(key);
  },

  async set(key, value, ttlSeconds) {
    if (ttlSeconds == null) {
      await redis.set(key, value);
    } else {
      await redis.set(key, value, { ex: ttlSeconds });
    }
  },

  async persist(key) {
    await redis.persist(key);
  },

  async del(...keys) {
    if (keys.length > 0) await redis.del(...keys);
  },

  // OBJECT IDLETIME is not available via the Upstash HTTP API.
  // The popular-matches feature degrades gracefully to [] on edge.
  async scanRecentKeys() {
    return [];
  },
};

export default adapter;
