import type { FastifyInstance } from "fastify";
import { verifyPersonaSignature, parsePersonaEvent } from "../services/persona";

export async function personaRoutes(app: FastifyInstance) {
  const { prisma, env } = app.container;

  app.post("/webhooks/persona", { config: { rawBody: true } }, async (req, reply) => {
    const raw = (req as any).rawBody as string | undefined;
    const sig = req.headers["persona-signature"] as string | undefined;
    const secret = env.PERSONA_WEBHOOK_SECRET;
    if (!secret || !raw || !verifyPersonaSignature(raw, sig, secret)) {
      return reply.status(401).send({ error: { code: "bad_signature", message: "Invalid signature" } });
    }
    const evt = parsePersonaEvent(req.body);
    if (!evt) return reply.status(204).send();

    if (evt.eventName === "inquiry.completed" && evt.status === "completed") {
      await prisma.workerProfile.updateMany({
        where: { personaInquiryId: evt.inquiryId },
        data: { verifiedAt: new Date() },
      });
    }
    reply.status(204).send();
  });
}
