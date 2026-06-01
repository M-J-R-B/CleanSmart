import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import { buildApp } from "../../app";
import { buildContainer } from "../../container";
import { getPrisma } from "@cleansmart/db";

const container = buildContainer();
container.env.PERSONA_WEBHOOK_SECRET = "testsecret";
const app = buildApp(container);
const prisma = getPrisma();

let workerId: string;

beforeAll(async () => {
  await prisma.workerProfile.deleteMany({ where: { user: { phone: "+15550000030" } } });
  await prisma.user.deleteMany({ where: { phone: "+15550000030" } });
  const u = await prisma.user.create({ data: { phone: "+15550000030", role: "worker" } });
  workerId = u.id;
  await prisma.workerProfile.create({ data: { userId: u.id, personaInquiryId: "inq_123" } });
});

afterAll(() => app.close());

function sign(body: string): string {
  return createHmac("sha256", "testsecret").update(body).digest("hex");
}

describe("persona webhook", () => {
  it("rejects bad signature", async () => {
    const payload = JSON.stringify({ data: { attributes: { name: "inquiry.completed", payload: { data: { id: "inq_123", attributes: { status: "completed" } } } } } });
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/persona",
      headers: { "persona-signature": "t=1,v1=bad", "content-type": "application/json" },
      payload,
    });
    expect(res.statusCode).toBe(401);
  });

  it("sets verifiedAt on inquiry.completed", async () => {
    const payload = JSON.stringify({
      data: {
        attributes: {
          name: "inquiry.completed",
          payload: { data: { id: "inq_123", attributes: { status: "completed" } } },
        },
      },
    });
    const sig = sign(payload);
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/persona",
      headers: { "persona-signature": `t=1,v1=${sig}`, "content-type": "application/json" },
      payload,
    });
    expect(res.statusCode).toBe(204);
    const wp = await prisma.workerProfile.findUnique({ where: { userId: workerId } });
    expect(wp?.verifiedAt).not.toBeNull();
  });

  it("does not set verifiedAt on failed status", async () => {
    await prisma.workerProfile.update({ where: { userId: workerId }, data: { verifiedAt: null } });
    const payload = JSON.stringify({
      data: {
        attributes: {
          name: "inquiry.completed",
          payload: { data: { id: "inq_123", attributes: { status: "failed" } } },
        },
      },
    });
    const sig = sign(payload);
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/persona",
      headers: { "persona-signature": `t=1,v1=${sig}`, "content-type": "application/json" },
      payload,
    });
    expect(res.statusCode).toBe(204);
    const wp = await prisma.workerProfile.findUnique({ where: { userId: workerId } });
    expect(wp?.verifiedAt).toBeNull();
  });
});
