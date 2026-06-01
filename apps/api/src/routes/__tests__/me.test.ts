import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../app";
import { buildContainer } from "../../container";
import { getPrisma } from "@cleansmart/db";

const container = buildContainer();
const app = buildApp(container);
const prisma = getPrisma();

let workerToken: string;
let workerId: string;

beforeAll(async () => {
  await prisma.workerProfile.deleteMany({ where: { user: { phone: "+15550000020" } } });
  await prisma.user.deleteMany({ where: { phone: "+15550000020" } });
  const u = await prisma.user.create({ data: { phone: "+15550000020", role: "worker", name: "Bob" } });
  workerId = u.id;
  await prisma.workerProfile.create({ data: { userId: u.id } });
  const pair = await container.tokens.issuePair(u.id, "worker");
  workerToken = pair.accessToken;
});

afterAll(() => app.close());

describe("/me", () => {
  it("GET /me returns user with worker profile", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${workerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(workerId);
    expect(body.workerProfile).toBeTruthy();
  });

  it("PATCH /me updates name", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/me",
      headers: { authorization: `Bearer ${workerToken}` },
      payload: { name: "Robert" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Robert");
  });

  it("PATCH /me/worker sets home location and updates geog column", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/me/worker",
      headers: { authorization: `Bearer ${workerToken}` },
      payload: { homeLat: 47.6062, homeLng: -122.3321, serviceRadiusKm: 20, bio: "Plumber 10y" },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.$queryRaw<Array<{ has_geog: boolean }>>`
      SELECT home_geog IS NOT NULL AS has_geog FROM worker_profiles WHERE user_id = ${workerId}::uuid
    `;
    expect(row[0].has_geog).toBe(true);
  });

  it("PATCH /me/worker forbidden for client role", async () => {
    const u = await prisma.user.upsert({
      where: { phone: "+15550000021" },
      update: {},
      create: { phone: "+15550000021", role: "client" },
    });
    const pair = await container.tokens.issuePair(u.id, "client");
    const res = await app.inject({
      method: "PATCH",
      url: "/me/worker",
      headers: { authorization: `Bearer ${pair.accessToken}` },
      payload: { homeLat: 1, homeLng: 1 },
    });
    expect(res.statusCode).toBe(403);
  });
});
