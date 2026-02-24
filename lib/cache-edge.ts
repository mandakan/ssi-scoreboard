// Edge-compatible cache adapter backed by Upstash Redis (HTTP).
// Used in Cloudflare Pages builds (DEPLOY_TARGET=cloudflare).
// Never import ioredis or any Node.js-only module from this file.
import { Redis } from "@upstash/redis";
import type { CacheAdapter } from "@/lib/cache";

// Lazily initialised so that Cloudflare secrets (injected into process.env at
// request time by @opennextjs/cloudflare) are read on first use rather than at
// module-evaluation time.  A module-level singleton would capture the empty
// strings present during Worker cold-start and stay broken for the Worker's
// lifetime, which is why caching silently failed even with secrets configured.
let _redis: Redis | null = null;

// automaticDeserialization: false keeps values as raw strings so callers
// can JSON.parse themselves — consistent with the ioredis adapter.
function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL ?? "";
    const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
    if (!url || !token) {
      console.error(
        "[cache-edge] UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is not set — " +
        "cache will not work. Check that secrets are configured in the Worker deployment.",
      );
    }
    _redis = new Redis({ url, token, automaticDeserialization: false });
  }
  return _redis;
}

const adapter: CacheAdapter = {
  async get(key) {
    return getRedis().get<string>(key);
  },

  async set(key, value, ttlSeconds) {
    if (ttlSeconds == null) {
      await getRedis().set(key, value);
    } else {
      await getRedis().set(key, value, { ex: ttlSeconds });
    }
  },

  async persist(key) {
    await getRedis().persist(key);
  },

  async del(...keys) {
    if (keys.length > 0) await getRedis().del(...keys);
  },

  // OBJECT IDLETIME is not available via the Upstash HTTP API.
  // The popular-matches feature degrades gracefully to [] on edge.
  async scanRecentKeys() {
    return [];
  },
};

export default adapter;
