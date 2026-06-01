import Fastify, { FastifyInstance } from "fastify";
import rawBody from "fastify-raw-body";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { meRoutes } from "./routes/me";
import { personaRoutes } from "./routes/persona";
import { buildContainer, type Container } from "./container";

export function buildApp(container: Container = buildContainer()): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.NODE_ENV === "test" ? "silent" : "info" } });
  app.decorate("container", container);
  app.register(rawBody, { field: "rawBody", global: false, encoding: "utf8", runFirst: true });
  app.register(personaRoutes);
  app.register(healthRoutes);
  app.register(authRoutes, { prefix: "/auth" });
  app.register(meRoutes);
  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    container: Container;
  }
}
