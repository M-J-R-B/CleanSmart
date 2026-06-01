import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildApp } from "../../app";
import { buildContainer } from "../../container";
import { getPrisma } from "@cleansmart/db";

const container = buildContainer();
container.otp = {
  send: vi.fn(async () => {}),
  verify: vi.fn(async (_phone: string, code: string) => code === "123456"),
};
const app = buildApp(container);
const prisma = getPrisma();

beforeAll(async () => {
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany({ where: { phone: { in: ["+15550000010", "+15550000011"] } } });
});

afterAll(async () => app.close());

describe("auth routes", () => {
  it("POST /auth/otp sends code", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/otp", payload: { phone: "+15550000010" } });
    expect(res.statusCode).toBe(204);
    expect(container.otp.send).toHaveBeenCalledWith("+15550000010");
  });

  it("POST /auth/verify creates user + returns tokens on first verify", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/verify",
      payload: { phone: "+15550000010", code: "123456", role: "client", name: "Alice" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.user.phone).toBe("+15550000010");
    expect(body.user.role).toBe("client");
  });

  it("POST /auth/verify returns existing user on second verify", async () => {
    await app.inject({
      method: "POST",
      url: "/auth/verify",
      payload: { phone: "+15550000010", code: "123456", role: "client" },
    });
    const count = await prisma.user.count({ where: { phone: "+15550000010" } });
    expect(count).toBe(1);
  });

  it("POST /auth/verify rejects bad code", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/verify",
      payload: { phone: "+15550000011", code: "000000", role: "client" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /auth/refresh rotates tokens", async () => {
    const verify = await app.inject({
      method: "POST",
      url: "/auth/verify",
      payload: { phone: "+15550000010", code: "123456", role: "client" },
    });
    const { refreshToken } = verify.json();
    const res = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.refreshToken).not.toBe(refreshToken);
  });

  it("POST /auth/logout revokes refresh token", async () => {
    const verify = await app.inject({
      method: "POST",
      url: "/auth/verify",
      payload: { phone: "+15550000010", code: "123456", role: "client" },
    });
    const { refreshToken } = verify.json();
    const res = await app.inject({ method: "POST", url: "/auth/logout", payload: { refreshToken } });
    expect(res.statusCode).toBe(204);
    const after = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken } });
    expect(after.statusCode).toBe(401);
  });
});
