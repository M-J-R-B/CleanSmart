import { FastifyInstance } from "fastify";
import { getPrisma } from "@cleansmart/db";
import IORedis from "ioredis";

let redis: IORedis | undefined;
function getRedis(): IORedis {
  if (!redis) redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", { lazyConnect: true });
  return redis;
}

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    const checks = { db: "fail", redis: "fail" };
    try {
      await getPrisma().$queryRaw`SELECT 1`;
      checks.db = "ok";
    } catch (err) {
      app.log.error({ err }, "db health check failed");
    }
    try {
      const r = getRedis();
      if (r.status !== "ready") await r.connect();
      const pong = await r.ping();
      if (pong === "PONG") checks.redis = "ok";
    } catch (err) {
      app.log.error({ err }, "redis health check failed");
    }
    const status = Object.values(checks).every((v) => v === "ok") ? "ok" : "degraded";
    return { status, checks };
  });
}
