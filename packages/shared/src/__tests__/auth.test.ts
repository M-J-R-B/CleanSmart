import { describe, it, expect } from "vitest";
import { OtpRequestSchema, OtpVerifySchema, RoleSchema } from "../schemas/auth";

describe("auth schemas", () => {
  it("validates phone format E.164", () => {
    expect(() => OtpRequestSchema.parse({ phone: "+15551234567" })).not.toThrow();
    expect(() => OtpRequestSchema.parse({ phone: "5551234567" })).toThrow();
  });

  it("requires role on first OTP verify", () => {
    expect(() =>
      OtpVerifySchema.parse({ phone: "+15551234567", code: "123456", role: "client" }),
    ).not.toThrow();
    expect(() =>
      OtpVerifySchema.parse({ phone: "+15551234567", code: "12", role: "client" }),
    ).toThrow();
  });

  it("rejects unknown role", () => {
    expect(() => RoleSchema.parse("admin")).not.toThrow();
    expect(() => RoleSchema.parse("hacker")).toThrow();
  });
});
