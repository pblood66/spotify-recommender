import Redis from "ioredis";
import { config } from "../config";

let instance: Redis | null = null;

export function getRedisClient(): Redis {
  if (instance) return instance;

  instance = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 10) {
        console.error("[Redis] too many reconnect attempts — giving up");
        return null;
      }
      return Math.min(times * 100, 3000);
    },
  });

  instance.on("connect", () => console.log("[Redis] connected"));
  instance.on("error", (err) => console.error("[Redis] error:", err.message));
  instance.on("reconnecting", () => console.warn("[Redis] reconnecting…"));

  return instance;
}

export async function closeRedis(): Promise<void> {
  if (instance) {
    await instance.quit();
    instance = null;
  }
}
