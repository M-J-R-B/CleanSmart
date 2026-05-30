import { describe, it, expect, afterAll } from "vitest";
import { buildApp } from "../app";

const app = buildApp();
afterAll(() => app.close());

describe("GET /health", () => {
  it("returns 200 with ok status and DB+Redis check results", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.checks.db).toBe("ok");
    expect(body.checks.redis).toBe("ok");
  });
});
