import { describe, it, expect, beforeAll } from "vitest";
import { createTokenService } from "../tokens";
import { getPrisma } from "@cleansmart/db";

const prisma = getPrisma();
const cfg = {
  accessSecret: "a".repeat(40),
  refreshSecret: "b".repeat(40),
  accessTtlSeconds: 60,
  refreshTtlSeconds: 3600,
};
const svc = createTokenService(prisma, cfg);

let userId: string;

beforeAll(async () => {
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany({ where: { phone: "+15550000001" } });
  const u = await prisma.user.create({ data: { phone: "+15550000001", role: "client" } });
  userId = u.id;
});

describe("token service", () => {
  it("issues access + refresh tokens", async () => {
    const pair = await svc.issuePair(userId, "client");
    expect(pair.accessToken).toMatch(/\..*\./);
    expect(pair.refreshToken.length).toBeGreaterThan(20);
  });

  it("verifies access token", async () => {
    const pair = await svc.issuePair(userId, "client");
    const claims = svc.verifyAccess(pair.accessToken);
    expect(claims.sub).toBe(userId);
    expect(claims.role).toBe("client");
  });

  it("rotates refresh token on use", async () => {
    const pair = await svc.issuePair(userId, "client");
    const next = await svc.rotateRefresh(pair.refreshToken);
    expect(next.refreshToken).not.toBe(pair.refreshToken);
    await expect(svc.rotateRefresh(pair.refreshToken)).rejects.toThrow(/revoked|invalid/i);
  });

  it("rejects refresh token after revocation", async () => {
    const pair = await svc.issuePair(userId, "client");
    await svc.revokeRefresh(pair.refreshToken);
    await expect(svc.rotateRefresh(pair.refreshToken)).rejects.toThrow();
  });
});
