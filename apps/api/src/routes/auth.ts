import type { FastifyInstance } from "fastify";
import { OtpRequestSchema, OtpVerifySchema, RefreshSchema } from "@cleansmart/shared";

export async function authRoutes(app: FastifyInstance) {
  const { otp, tokens, prisma } = app.container;

  app.post("/otp", async (req, reply) => {
    const body = OtpRequestSchema.parse(req.body);
    try {
      await otp.send(body.phone);
      reply.status(204).send();
    } catch (err) {
      if (err instanceof Error && /rate limit/i.test(err.message)) {
        return reply.status(429).send({ error: { code: "rate_limited", message: err.message } });
      }
      throw err;
    }
  });

  app.post("/verify", async (req, reply) => {
    const body = OtpVerifySchema.parse(req.body);
    const ok = await otp.verify(body.phone, body.code);
    if (!ok) return reply.status(401).send({ error: { code: "otp_invalid", message: "Invalid code" } });

    const user = await prisma.user.upsert({
      where: { phone: body.phone },
      update: { name: body.name ?? undefined },
      create: { phone: body.phone, role: body.role, name: body.name ?? null },
    });

    if (user.role === "client") {
      await prisma.clientProfile.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });
    } else if (user.role === "worker") {
      await prisma.workerProfile.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });
    }

    const pair = await tokens.issuePair(user.id, user.role);
    return {
      ...pair,
      user: { id: user.id, phone: user.phone, role: user.role, name: user.name },
    };
  });

  app.post("/refresh", async (req, reply) => {
    const body = RefreshSchema.parse(req.body);
    try {
      const pair = await tokens.rotateRefresh(body.refreshToken);
      return pair;
    } catch {
      return reply.status(401).send({ error: { code: "refresh_invalid", message: "Invalid refresh token" } });
    }
  });

  app.post("/logout", async (req, reply) => {
    const body = RefreshSchema.parse(req.body);
    await tokens.revokeRefresh(body.refreshToken);
    reply.status(204).send();
  });
}
