import type { FastifyInstance } from "fastify";
import { requireAuth, requireRole } from "../middleware/auth";
import { UpdateMeSchema, UpdateWorkerSchema, UpdateClientSchema } from "@cleansmart/shared";

export async function meRoutes(app: FastifyInstance) {
  const { prisma } = app.container;

  app.get("/me", { preHandler: requireAuth }, async (req) => {
    return prisma.user.findUniqueOrThrow({
      where: { id: req.userId! },
      include: { clientProfile: true, workerProfile: true },
    });
  });

  app.patch("/me", { preHandler: requireAuth }, async (req) => {
    const body = UpdateMeSchema.parse(req.body);
    return prisma.user.update({ where: { id: req.userId! }, data: body });
  });

  app.patch("/me/worker", { preHandler: [requireAuth, requireRole("worker")] }, async (req) => {
    const body = UpdateWorkerSchema.parse(req.body);
    const updated = await prisma.workerProfile.update({
      where: { userId: req.userId! },
      data: body,
    });
    if (body.homeLat !== undefined && body.homeLng !== undefined) {
      await prisma.$executeRaw`
        UPDATE worker_profiles
        SET home_geog = ST_SetSRID(ST_MakePoint(${body.homeLng}, ${body.homeLat}), 4326)::geography
        WHERE user_id = ${req.userId!}::uuid
      `;
    }
    return updated;
  });

  app.patch("/me/client", { preHandler: [requireAuth, requireRole("client")] }, async (req) => {
    const body = UpdateClientSchema.parse(req.body);
    return prisma.clientProfile.update({ where: { userId: req.userId! }, data: body });
  });
}
