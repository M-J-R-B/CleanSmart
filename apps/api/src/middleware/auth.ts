import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { Role } from "@cleansmart/shared";

export const requireAuth: preHandlerHookHandler = async (req: FastifyRequest, reply: FastifyReply) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return reply.status(401).send({ error: { code: "unauthorized", message: "Missing token" } });
  }
  const token = header.slice("Bearer ".length);
  try {
    const claims = req.server.container.tokens.verifyAccess(token);
    req.userId = claims.sub;
    req.userRole = claims.role;
  } catch {
    return reply.status(401).send({ error: { code: "unauthorized", message: "Invalid token" } });
  }
};

export function requireRole(...allowed: Role[]): preHandlerHookHandler {
  return async (req, reply) => {
    if (!req.userRole || !allowed.includes(req.userRole)) {
      return reply.status(403).send({ error: { code: "forbidden", message: "Insufficient role" } });
    }
  };
}

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
    userRole?: Role;
  }
}
