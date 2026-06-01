import { describe, it, expect } from "vitest";
import { parseEnv } from "../env";

describe("parseEnv", () => {
  it("parses valid environment", () => {
    const result = parseEnv({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://x:y@localhost:5432/db",
      REDIS_URL: "redis://localhost:6379",
      PORT: "3000",
      JWT_ACCESS_SECRET: "a".repeat(40),
      JWT_REFRESH_SECRET: "b".repeat(40),
      TWILIO_ACCOUNT_SID: "ACxxxxxxxxx",
      TWILIO_AUTH_TOKEN: "tokentokentoken",
      TWILIO_VERIFY_SERVICE_SID: "VAxxxxxxxxx",
    });
    expect(result.NODE_ENV).toBe("development");
    expect(result.PORT).toBe(3000);
  });

  it("throws on missing DATABASE_URL", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "development",
        REDIS_URL: "redis://localhost:6379",
        JWT_ACCESS_SECRET: "a".repeat(40),
        JWT_REFRESH_SECRET: "b".repeat(40),
        TWILIO_ACCOUNT_SID: "ACxxxxxxxxx",
        TWILIO_AUTH_TOKEN: "tokentokentoken",
        TWILIO_VERIFY_SERVICE_SID: "VAxxxxxxxxx",
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it("rejects invalid NODE_ENV", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "staging",
        DATABASE_URL: "postgresql://x",
        REDIS_URL: "redis://x",
      }),
    ).toThrow();
  });
});
