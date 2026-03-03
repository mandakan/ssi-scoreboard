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

async function recordMatchAccess(key: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await Promise.all([
    getRedis().zadd(pk("popular:matches:seen"), { score: now, member: key }),
    getRedis().zincrby(pk("popular:matches:hits"), 1, key),
  ]);
}

async function getPopularKeys(
  maxAgeSeconds: number,
  limit: number,
): Promise<{ key: string; hits: number }[]> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - maxAgeSeconds;

  // Prune entries that haven't been seen within the window.
  await getRedis().zremrangebyscore(pk("popular:matches:seen"), "-inf", cutoff - 1);

  // Fetch all keys that were seen within the window.
  // zrange with byScore: true is equivalent to ZRANGEBYSCORE.
  // Use now + 86400 as upper bound (well beyond any valid timestamp).
  const recentKeys = (await getRedis().zrange(
    pk("popular:matches:seen"),
    cutoff,
    now + 86400,
    { byScore: true },
  )) as string[];

  if (recentKeys.length === 0) return [];

  // Look up hit counts for each recent key in parallel.
  // zscore always returns number | null (scores are numeric in Redis).
  const hitScores = await Promise.all(
    recentKeys.map((k: string) => getRedis().zscore(pk("popular:matches:hits"), k)),
  );

  const results = recentKeys.map((k: string, i: number) => ({
    key: k,
    hits: Math.round(hitScores[i] ?? 0),
  }));

  return results
    .sort(
      (a: { key: string; hits: number }, b: { key: string; hits: number }) =>
        b.hits - a.hits,
    )
    .slice(0, limit);
}

async function indexShooterMatch(
  shooterId: number,
  matchRef: string,
  startTimestamp: number,
): Promise<void> {
  await getRedis().zadd(pk(`shooter:${shooterId}:matches`), {
    score: startTimestamp,
    member: matchRef,
  });
}

async function setShooterProfile(shooterId: number, profile: string): Promise<void> {
  await getRedis().set(pk(`shooter:${shooterId}:profile`), profile);
}

async function getShooterMatches(shooterId: number): Promise<string[]> {
  return (await getRedis().zrange(
    pk(`shooter:${shooterId}:matches`),
    0,
    -1,
  )) as string[];
}

async function getShooterProfile(shooterId: number): Promise<string | null> {
  return getRedis().get<string>(pk(`shooter:${shooterId}:profile`));
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

  recordMatchAccess,
  getPopularKeys,
  indexShooterMatch,
  setShooterProfile,
  getShooterMatches,
  getShooterProfile,
};

export default adapter;
