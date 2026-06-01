import { describe, it, expect, beforeEach, vi } from "vitest";
import { createOtpService } from "../otp";

const fakeVerify = {
  verifications: { create: vi.fn() },
  verificationChecks: { create: vi.fn() },
};
const fakeTwilio = { verify: { v2: { services: () => fakeVerify } } };

const fakeRedis = (() => {
  const store = new Map<string, string>();
  return {
    incr: vi.fn(async (k: string) => {
      const n = (Number(store.get(k)) || 0) + 1;
      store.set(k, String(n));
      return n;
    }),
    expire: vi.fn(async () => 1),
    del: vi.fn(async (k: string) => store.delete(k)),
  };
})();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("otp service", () => {
  it("sends OTP via Twilio", async () => {
    fakeVerify.verifications.create.mockResolvedValue({ status: "pending" });
    const svc = createOtpService(fakeTwilio as any, fakeRedis as any, "VA1");
    await svc.send("+15551234567");
    expect(fakeVerify.verifications.create).toHaveBeenCalledWith({ to: "+15551234567", channel: "sms" });
  });

  it("verifies OTP via Twilio and returns true on approved", async () => {
    fakeVerify.verificationChecks.create.mockResolvedValue({ status: "approved" });
    const svc = createOtpService(fakeTwilio as any, fakeRedis as any, "VA1");
    const ok = await svc.verify("+15551234567", "123456");
    expect(ok).toBe(true);
  });

  it("returns false when Twilio status is not approved", async () => {
    fakeVerify.verificationChecks.create.mockResolvedValue({ status: "pending" });
    const svc = createOtpService(fakeTwilio as any, fakeRedis as any, "VA1");
    expect(await svc.verify("+15551234567", "999999")).toBe(false);
  });

  it("rate-limits sends to 5 per phone per hour", async () => {
    fakeVerify.verifications.create.mockResolvedValue({ status: "pending" });
    const svc = createOtpService(fakeTwilio as any, fakeRedis as any, "VA1");
    for (let i = 0; i < 5; i++) await svc.send("+15551234567");
    await expect(svc.send("+15551234567")).rejects.toThrow(/rate limit/i);
  });
});
