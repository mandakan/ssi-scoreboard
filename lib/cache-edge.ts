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

// Prefix all Redis key names with CACHE_KEY_PREFIX (e.g. "staging:") so that
// multiple environments can safely share a single Upstash instance.
// Members stored inside sorted sets are bare cache keys, not Redis key names,
// so they are not prefixed — callers receive them as-is.
const PREFIX = process.env.CACHE_KEY_PREFIX ?? "";
const pk = (key: string) => `${PREFIX}${key}`;

// Extracted as module-level functions so tsc can resolve the return type unambiguously.

async function scanCachedMatchKeys(): Promise<string[]> {
  const pattern = `${PREFIX}gql:GetMatch:*`;
  const keys: string[] = [];
  let cursor = "0";
  do {
    const result = await getRedis().scan(cursor, { match: pattern, count: 200 });
    const [nextCursor, batch] = result as [string, string[]];
    cursor = nextCursor;
    for (const key of batch) {
      keys.push(key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key);
    }
  } while (cursor !== "0");
  return keys;
}

const adapter: CacheAdapter = {
  async get(key) {
    return getRedis().get<string>(pk(key));
  },

  async set(key, value, ttlSeconds) {
    if (ttlSeconds == null) {
      await getRedis().set(pk(key), value);
    } else {
      await getRedis().set(pk(key), value, { ex: ttlSeconds });
    }
  },

  async persist(key) {
    await getRedis().persist(pk(key));
  },

  async del(...keys) {
    if (keys.length > 0) await getRedis().del(...keys.map(pk));
  },

  async expire(key, ttlSeconds) {
    await getRedis().expire(pk(key), ttlSeconds);
  },

  scanCachedMatchKeys,
};

export default adapter;
