import Fastify, { FastifyInstance } from "fastify";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { buildContainer, type Container } from "./container";

export function buildApp(container: Container = buildContainer()): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.NODE_ENV === "test" ? "silent" : "info" } });
  app.decorate("container", container);
  app.register(healthRoutes);
  app.register(authRoutes, { prefix: "/auth" });
  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    container: Container;
  }
}
