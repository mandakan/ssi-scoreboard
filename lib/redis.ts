// Server-only — never import from client components or files with "use client".
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
  lazyConnect: true,
});

redis.on("error", (err: Error) => console.error("[redis]", err.message));

export default redis;
