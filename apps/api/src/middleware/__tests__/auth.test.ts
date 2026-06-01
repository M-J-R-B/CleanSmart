import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import { requireAuth, requireRole } from "../auth";
import { buildContainer } from "../../container";

const container = buildContainer();
const app = Fastify();
app.decorate("container", container);
app.get("/protected", { preHandler: requireAuth }, async (req) => ({ userId: req.userId, role: req.userRole }));
app.get("/admin-only", { preHandler: [requireAuth, requireRole("admin")] }, async () => ({ ok: true }));

const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

beforeAll(async () => {
  await container.prisma.user.upsert({
    where: { id: TEST_USER_ID },
    update: {},
    create: { id: TEST_USER_ID, phone: "+15550099999", role: "client" },
  });
});

afterAll(() => app.close());

describe("auth middleware", () => {
  it("rejects missing Authorization header", async () => {
    const res = await app.inject({ method: "GET", url: "/protected" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects malformed token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer junk" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts valid token", async () => {
    const pair = await container.tokens.issuePair("00000000-0000-0000-0000-000000000001", "client");
    const res = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${pair.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("client");
  });

  it("forbids wrong role", async () => {
    const pair = await container.tokens.issuePair("00000000-0000-0000-0000-000000000001", "client");
    const res = await app.inject({
      method: "GET",
      url: "/admin-only",
      headers: { authorization: `Bearer ${pair.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
