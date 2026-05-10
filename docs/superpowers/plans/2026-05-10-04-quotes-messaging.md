# CleanSmart Quotes & Messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Workers can submit and withdraw quotes; clients can view them. Per-job message threads with persistence + Socket.io realtime. Push notifications via Expo for new jobs (workers) and new quotes/messages (clients).

**Architecture:** Quotes are children of jobs; messages are children of jobs (thread survives quote → booking transition). Realtime layer is Socket.io with namespace `/jobs/:jobId` requiring JWT auth. Push fan-out runs in BullMQ worker. Expo Push Tokens stored on user.

**Tech Stack:** Socket.io 4, BullMQ 5, Expo Server SDK, Fastify.

**Depends on:** Plans 1-3 complete.

---

### Task 1: Schema — Quote, Message, Notification, ExpoPushToken

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add models**

Append to schema.prisma:

```prisma
enum QuoteStatus {
  pending
  accepted
  rejected
  withdrawn
}

model Quote {
  id          String      @id @default(uuid()) @db.Uuid
  jobId       String      @map("job_id") @db.Uuid
  workerId    String      @map("worker_id") @db.Uuid
  amountCents Int         @map("amount_cents")
  message     String?
  etaMinutes  Int?        @map("eta_minutes")
  status      QuoteStatus @default(pending)
  createdAt   DateTime    @default(now()) @map("created_at")
  updatedAt   DateTime    @updatedAt @map("updated_at")

  job    Job  @relation(fields: [jobId], references: [id], onDelete: Cascade)
  worker User @relation("workerQuotes", fields: [workerId], references: [id])

  @@unique([jobId, workerId])
  @@index([workerId, status])
  @@map("quotes")
}

model Message {
  id        String   @id @default(uuid()) @db.Uuid
  jobId     String   @map("job_id") @db.Uuid
  senderId  String   @map("sender_id") @db.Uuid
  body      String
  createdAt DateTime @default(now()) @map("created_at")

  job    Job  @relation(fields: [jobId], references: [id], onDelete: Cascade)
  sender User @relation("sentMessages", fields: [senderId], references: [id])

  @@index([jobId, createdAt])
  @@map("messages")
}

model Notification {
  id        String    @id @default(uuid()) @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  type      String
  payload   Json
  readAt    DateTime? @map("read_at")
  createdAt DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, readAt, createdAt])
  @@map("notifications")
}

model ExpoPushToken {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  token     String   @unique
  platform  String
  createdAt DateTime @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("expo_push_tokens")
}
```

- [ ] **Step 2: Add back-relations on User and Job**

In `User`:
```prisma
quotes        Quote[]         @relation("workerQuotes")
sentMessages  Message[]       @relation("sentMessages")
notifications Notification[]
pushTokens    ExpoPushToken[]
```

In `Job`:
```prisma
quotes   Quote[]
messages Message[]
```

- [ ] **Step 3: Migrate**

Run: `pnpm --filter @cleansmart/db prisma:migrate:dev --name quotes_messages_notifications`

- [ ] **Step 4: Commit**

```bash
git add packages/db/
git commit -m "feat(db): add Quote, Message, Notification, ExpoPushToken"
```

---

### Task 2: Quote schemas

**Files:**
- Create: `packages/shared/src/schemas/quotes.ts`
- Modify: `packages/shared/src/schemas/index.ts`

- [ ] **Step 1: Create quotes.ts**

```ts
import { z } from "zod";

export const CreateQuoteSchema = z.object({
  amountCents: z.number().int().min(500).max(10_000_000),
  message: z.string().max(2000).optional(),
  etaMinutes: z.number().int().min(5).max(480).optional(),
});
export type CreateQuote = z.infer<typeof CreateQuoteSchema>;

export const PostMessageSchema = z.object({
  body: z.string().min(1).max(2000),
});
export type PostMessage = z.infer<typeof PostMessageSchema>;

export const RegisterPushTokenSchema = z.object({
  token: z.string().min(20),
  platform: z.enum(["ios", "android"]),
});
export type RegisterPushToken = z.infer<typeof RegisterPushTokenSchema>;
```

- [ ] **Step 2: Export and build**

Add `export * from "./quotes";` to schemas/index.ts.
Run: `pnpm --filter @cleansmart/shared build`

- [ ] **Step 3: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): add quote, message, push schemas"
```

---

### Task 3: Quote routes — POST/GET/DELETE

**Files:**
- Create: `apps/api/src/routes/quotes.ts`
- Create: `apps/api/src/routes/__tests__/quotes.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../app";
import { buildContainer } from "../../container";
import { getPrisma } from "@cleansmart/db";

const container = buildContainer();
const app = buildApp(container);
const prisma = getPrisma();

let clientToken: string, workerToken: string, otherWorkerToken: string;
let clientId: string, workerId: string, jobId: string, tradeId: string;

beforeAll(async () => {
  await prisma.quote.deleteMany();
  await prisma.job.deleteMany();
  await prisma.user.deleteMany({ where: { phone: { in: ["+15550000060","+15550000061","+15550000062"] } } });
  const c = await prisma.user.create({ data: { phone: "+15550000060", role: "client", clientProfile: { create: {} } } });
  clientId = c.id;
  clientToken = (await container.tokens.issuePair(c.id, "client")).accessToken;
  const w = await prisma.user.create({ data: { phone: "+15550000061", role: "worker", workerProfile: { create: {} } } });
  workerId = w.id;
  workerToken = (await container.tokens.issuePair(w.id, "worker")).accessToken;
  const w2 = await prisma.user.create({ data: { phone: "+15550000062", role: "worker", workerProfile: { create: {} } } });
  otherWorkerToken = (await container.tokens.issuePair(w2.id, "worker")).accessToken;
  const trade = await prisma.trade.findFirstOrThrow({ where: { slug: "cleaning" } });
  tradeId = trade.id;
  const job = await prisma.job.create({
    data: { clientId, tradeId, title: "T", description: "1234567890", address: "x", lat: 47.6, lng: -122.3, urgency: "now" },
  });
  jobId = job.id;
});

afterAll(() => app.close());

describe("quotes", () => {
  it("POST /jobs/:id/quotes creates quote", async () => {
    const res = await app.inject({
      method: "POST", url: `/jobs/${jobId}/quotes`,
      headers: { authorization: `Bearer ${workerToken}` },
      payload: { amountCents: 12000, message: "Available now", etaMinutes: 30 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe("pending");
  });

  it("rejects duplicate quote from same worker", async () => {
    const res = await app.inject({
      method: "POST", url: `/jobs/${jobId}/quotes`,
      headers: { authorization: `Bearer ${workerToken}` },
      payload: { amountCents: 13000 },
    });
    expect(res.statusCode).toBe(409);
  });

  it("GET /jobs/:id/quotes returns all quotes for client", async () => {
    await app.inject({
      method: "POST", url: `/jobs/${jobId}/quotes`,
      headers: { authorization: `Bearer ${otherWorkerToken}` },
      payload: { amountCents: 9000 },
    });
    const res = await app.inject({
      method: "GET", url: `/jobs/${jobId}/quotes`,
      headers: { authorization: `Bearer ${clientToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBe(2);
  });

  it("GET /me/quotes returns worker's own quotes", async () => {
    const res = await app.inject({
      method: "GET", url: "/me/quotes",
      headers: { authorization: `Bearer ${workerToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBeGreaterThanOrEqual(1);
  });

  it("DELETE /quotes/:id withdraws own pending quote", async () => {
    const q = await prisma.quote.findFirstOrThrow({ where: { workerId, jobId } });
    const res = await app.inject({
      method: "DELETE", url: `/quotes/${q.id}`,
      headers: { authorization: `Bearer ${workerToken}` },
    });
    expect(res.statusCode).toBe(204);
    const updated = await prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(updated.status).toBe("withdrawn");
  });

  it("forbids withdrawing other worker's quote", async () => {
    const q = await prisma.quote.findFirstOrThrow({ where: { jobId, workerId: { not: workerId } } });
    const res = await app.inject({
      method: "DELETE", url: `/quotes/${q.id}`,
      headers: { authorization: `Bearer ${workerToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Implement quotes.ts**

```ts
import type { FastifyInstance } from "fastify";
import { CreateQuoteSchema } from "@cleansmart/shared";
import { requireAuth, requireRole } from "../middleware/auth";

export async function quoteRoutes(app: FastifyInstance) {
  const { prisma } = app.container;

  app.post("/jobs/:id/quotes", { preHandler: [requireAuth, requireRole("worker")] }, async (req, reply) => {
    const jobId = (req.params as any).id;
    const body = CreateQuoteSchema.parse(req.body);
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return reply.status(404).send({ error: { code: "not_found", message: "Job not found" } });
    if (job.status !== "open") return reply.status(409).send({ error: { code: "job_closed", message: "Job is not open" } });
    const existing = await prisma.quote.findUnique({ where: { jobId_workerId: { jobId, workerId: req.userId! } } });
    if (existing) return reply.status(409).send({ error: { code: "duplicate", message: "Quote already submitted" } });
    const quote = await prisma.quote.create({
      data: {
        jobId, workerId: req.userId!,
        amountCents: body.amountCents, message: body.message, etaMinutes: body.etaMinutes,
      },
    });
    if (job.status === "open") await prisma.job.update({ where: { id: jobId }, data: { status: "quoted" } });
    reply.status(201);
    return quote;
  });

  app.get("/jobs/:id/quotes", { preHandler: requireAuth }, async (req, reply) => {
    const jobId = (req.params as any).id;
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return reply.status(404).send({ error: { code: "not_found", message: "Job not found" } });
    if (job.clientId !== req.userId && req.userRole !== "admin") {
      return reply.status(403).send({ error: { code: "forbidden", message: "Not your job" } });
    }
    return prisma.quote.findMany({
      where: { jobId },
      include: { worker: { include: { workerProfile: true } } },
      orderBy: { createdAt: "asc" },
    });
  });

  app.get("/me/quotes", { preHandler: [requireAuth, requireRole("worker")] }, async (req) => {
    return prisma.quote.findMany({
      where: { workerId: req.userId! },
      include: { job: { include: { trade: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  });

  app.delete("/quotes/:id", { preHandler: [requireAuth, requireRole("worker")] }, async (req, reply) => {
    const id = (req.params as any).id;
    const quote = await prisma.quote.findUnique({ where: { id } });
    if (!quote) return reply.status(404).send({ error: { code: "not_found", message: "Quote not found" } });
    if (quote.workerId !== req.userId) return reply.status(403).send({ error: { code: "forbidden", message: "Not your quote" } });
    if (quote.status !== "pending") return reply.status(409).send({ error: { code: "invalid_state", message: "Cannot withdraw" } });
    await prisma.quote.update({ where: { id }, data: { status: "withdrawn" } });
    reply.status(204).send();
  });
}
```

- [ ] **Step 3: Wire and run**

Add `import { quoteRoutes } from "./routes/quotes";` and `app.register(quoteRoutes);` in app.ts.
Run: `pnpm --filter @cleansmart/api test`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/
git commit -m "feat(api): quote routes (create/list/withdraw)"
```

---

### Task 4: BullMQ queue setup + push notification job

**Files:**
- Create: `apps/api/src/queue/index.ts`
- Create: `apps/api/src/queue/push.ts`
- Create: `apps/api/src/queue/__tests__/push.test.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Add expo deps**

Run: `pnpm --filter @cleansmart/api add expo-server-sdk@3.10.0`

- [ ] **Step 2: Create queue/index.ts**

```ts
import { Queue, Worker, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

export const QUEUE_NAMES = {
  push: "push",
  jobFanout: "job-fanout",
  escrowAutoRelease: "escrow-auto-release",
} as const;

let connection: IORedis | undefined;

export function getQueueConnection(redisUrl: string): ConnectionOptions {
  if (!connection) {
    connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function makeQueue<T = unknown>(name: string, redisUrl: string) {
  return new Queue<T>(name, { connection: getQueueConnection(redisUrl) });
}

export function makeWorker<T = unknown>(name: string, redisUrl: string, processor: (job: { data: T }) => Promise<void>) {
  return new Worker<T>(name, async (job) => processor(job), {
    connection: getQueueConnection(redisUrl),
  });
}
```

- [ ] **Step 3: Failing push test**

```ts
import { describe, it, expect, vi } from "vitest";
import { sendPushNotification } from "../push";

const fakeExpo = {
  chunkPushNotifications: (msgs: any[]) => [msgs],
  sendPushNotificationsAsync: vi.fn(async () => [{ status: "ok" }]),
};

describe("sendPushNotification", () => {
  it("sends to Expo for each token", async () => {
    await sendPushNotification(fakeExpo as any, [
      { token: "ExponentPushToken[abc]", title: "Hi", body: "Body", data: { jobId: "j1" } },
    ]);
    expect(fakeExpo.sendPushNotificationsAsync).toHaveBeenCalledOnce();
  });

  it("ignores invalid tokens silently", async () => {
    await sendPushNotification(fakeExpo as any, [{ token: "junk", title: "x", body: "y" }]);
    expect(fakeExpo.sendPushNotificationsAsync).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Implement queue/push.ts**

```ts
import Expo, { type ExpoPushMessage } from "expo-server-sdk";

export interface PushPayload {
  token: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export async function sendPushNotification(expo: Pick<Expo, "chunkPushNotifications" | "sendPushNotificationsAsync">, payloads: PushPayload[]) {
  const valid = payloads.filter((p) => Expo.isExpoPushToken(p.token));
  if (valid.length === 0) return;
  const messages: ExpoPushMessage[] = valid.map((p) => ({
    to: p.token, sound: "default", title: p.title, body: p.body, data: p.data,
  }));
  for (const chunk of expo.chunkPushNotifications(messages)) {
    await expo.sendPushNotificationsAsync(chunk);
  }
}

export async function startPushWorker(redisUrl: string) {
  const { makeWorker } = await import("./index");
  const expo = new Expo();
  return makeWorker<PushPayload[]>("push", redisUrl, async ({ data }) => {
    await sendPushNotification(expo, data);
  });
}
```

- [ ] **Step 5: Run, pass, commit**

Run: `pnpm --filter @cleansmart/api test`

```bash
git add apps/api/src/queue/ apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): bullmq + expo push notification worker"
```

---

### Task 5: Job fan-out job — push to nearby workers on job.created

**Files:**
- Create: `apps/api/src/queue/job-fanout.ts`
- Modify: `apps/api/src/routes/jobs.ts`
- Create: `apps/api/src/queue/__tests__/job-fanout.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll, vi } from "vitest";
import { fanoutJobToNearbyWorkers } from "../job-fanout";
import { getPrisma } from "@cleansmart/db";

const prisma = getPrisma();

let jobId: string;
let workerToken: string; // unused but document setup

beforeAll(async () => {
  // ensure prior data setup creates job with location_geog and a worker subscribed to its trade nearby
});

describe("fanoutJobToNearbyWorkers", () => {
  it("returns nearby worker user IDs subscribed to the trade with push tokens", async () => {
    // setup
    const trade = await prisma.trade.findFirstOrThrow({ where: { slug: "cleaning" } });
    const c = await prisma.user.upsert({
      where: { phone: "+15550000070" }, update: {},
      create: { phone: "+15550000070", role: "client", clientProfile: { create: {} } },
    });
    const job = await prisma.job.create({
      data: { clientId: c.id, tradeId: trade.id, title: "Z", description: "1234567890", address: "x", lat: 47.6, lng: -122.3, urgency: "now" },
    });
    await prisma.$executeRaw`UPDATE jobs SET location_geog = ST_SetSRID(ST_MakePoint(-122.3, 47.6), 4326)::geography WHERE id = ${job.id}::uuid`;
    jobId = job.id;

    const w = await prisma.user.upsert({
      where: { phone: "+15550000071" }, update: {},
      create: { phone: "+15550000071", role: "worker", workerProfile: { create: { serviceRadiusKm: 25, homeLat: 47.6, homeLng: -122.3 } } },
    });
    await prisma.$executeRaw`UPDATE worker_profiles SET home_geog = ST_SetSRID(ST_MakePoint(-122.3, 47.6), 4326)::geography WHERE user_id = ${w.id}::uuid`;
    await prisma.workerTrade.upsert({
      where: { workerId_tradeId: { workerId: w.id, tradeId: trade.id } },
      update: {}, create: { workerId: w.id, tradeId: trade.id },
    });
    await prisma.expoPushToken.upsert({
      where: { token: "ExponentPushToken[testabc]" },
      update: {}, create: { userId: w.id, token: "ExponentPushToken[testabc]", platform: "ios" },
    });

    const result = await fanoutJobToNearbyWorkers(prisma, jobId);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].token).toContain("ExponentPushToken");
  });
});
```

- [ ] **Step 2: Implement queue/job-fanout.ts**

```ts
import type { PrismaClient } from "@cleansmart/db";
import type { PushPayload } from "./push";

interface NearbyWorkerRow {
  user_id: string;
  token: string;
  title: string;
  trade_name: string;
}

export async function fanoutJobToNearbyWorkers(prisma: PrismaClient, jobId: string): Promise<PushPayload[]> {
  const rows = await prisma.$queryRaw<NearbyWorkerRow[]>`
    SELECT DISTINCT w.user_id, t.token, j.title, tr.name AS trade_name
    FROM jobs j
    JOIN worker_trades wt ON wt.trade_id = j.trade_id
    JOIN worker_profiles w ON w.user_id = wt.worker_id
    JOIN expo_push_tokens t ON t.user_id = w.user_id
    JOIN trades tr ON tr.id = j.trade_id
    WHERE j.id = ${jobId}::uuid
      AND ST_DWithin(j.location_geog, w.home_geog, w.service_radius_km * 1000)
    ORDER BY ST_Distance(j.location_geog, w.home_geog) ASC
    LIMIT 50
  `;
  return rows.map((r) => ({
    token: r.token,
    title: `New ${r.trade_name} job`,
    body: r.title,
    data: { type: "new_job", jobId },
  }));
}
```

- [ ] **Step 3: Enqueue from POST /jobs**

In `apps/api/src/routes/jobs.ts`, after the geog UPDATE in POST /jobs:

```ts
import { makeQueue } from "../queue";
// ...
const pushQueue = makeQueue<unknown>("push", app.container.env.REDIS_URL);
const fanoutQueue = makeQueue<{ jobId: string }>("job-fanout", app.container.env.REDIS_URL);
await fanoutQueue.add("fanout", { jobId: job.id });
```

(Move queue creation into the container in a polish step if desired; for now scoped to the route.)

- [ ] **Step 4: Worker entry point**

Create `apps/api/src/workers/index.ts`:

```ts
import "dotenv/config";
import { parseEnv } from "@cleansmart/shared";
import { getPrisma } from "@cleansmart/db";
import { makeQueue, makeWorker } from "../queue";
import { fanoutJobToNearbyWorkers } from "../queue/job-fanout";
import { startPushWorker } from "../queue/push";

const env = parseEnv(process.env);
const prisma = getPrisma();
const pushQueue = makeQueue("push", env.REDIS_URL);

makeWorker<{ jobId: string }>("job-fanout", env.REDIS_URL, async ({ data }) => {
  const payloads = await fanoutJobToNearbyWorkers(prisma, data.jobId);
  if (payloads.length) await pushQueue.add("send", payloads);
});

startPushWorker(env.REDIS_URL);
console.log("Workers started.");
```

Add to `apps/api/package.json`:
```json
"scripts": { ..., "workers": "tsx src/workers/index.ts" }
```

- [ ] **Step 5: Run, pass, commit**

Run: `pnpm --filter @cleansmart/api test`

```bash
git add apps/api/src/
git commit -m "feat(api): job fan-out to nearby workers via BullMQ"
```

---

### Task 6: Push token registration — POST /me/push-tokens

**Files:**
- Modify: `apps/api/src/routes/me.ts`
- Modify: `apps/api/src/routes/__tests__/me.test.ts`

- [ ] **Step 1: Test**

```ts
it("POST /me/push-tokens registers a push token", async () => {
  const res = await app.inject({
    method: "POST", url: "/me/push-tokens",
    headers: { authorization: `Bearer ${workerToken}` },
    payload: { token: "ExponentPushToken[xyz]", platform: "ios" },
  });
  expect(res.statusCode).toBe(204);
  const count = await prisma.expoPushToken.count({ where: { userId: workerId } });
  expect(count).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 2: Implement**

In `routes/me.ts`:

```ts
import { RegisterPushTokenSchema } from "@cleansmart/shared";
// ...
app.post("/me/push-tokens", { preHandler: requireAuth }, async (req, reply) => {
  const body = RegisterPushTokenSchema.parse(req.body);
  await prisma.expoPushToken.upsert({
    where: { token: body.token },
    update: { userId: req.userId!, platform: body.platform },
    create: { userId: req.userId!, token: body.token, platform: body.platform },
  });
  reply.status(204).send();
});

app.delete("/me/push-tokens/:token", { preHandler: requireAuth }, async (req, reply) => {
  const token = (req.params as any).token;
  await prisma.expoPushToken.deleteMany({ where: { userId: req.userId!, token } });
  reply.status(204).send();
});
```

- [ ] **Step 3: Run, commit**

```bash
git add apps/api/src/
git commit -m "feat(api): push token registration"
```

---

### Task 7: Messaging routes — POST /jobs/:id/messages, GET history

**Files:**
- Create: `apps/api/src/routes/messages.ts`
- Create: `apps/api/src/routes/__tests__/messages.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../app";
import { buildContainer } from "../../container";
import { getPrisma } from "@cleansmart/db";

const container = buildContainer();
const app = buildApp(container);
const prisma = getPrisma();

let clientToken: string, workerToken: string, outsiderToken: string;
let jobId: string;

beforeAll(async () => {
  await prisma.message.deleteMany();
  await prisma.user.deleteMany({ where: { phone: { in: ["+15550000080","+15550000081","+15550000082"] } } });
  const c = await prisma.user.create({ data: { phone: "+15550000080", role: "client", clientProfile: { create: {} } } });
  clientToken = (await container.tokens.issuePair(c.id, "client")).accessToken;
  const w = await prisma.user.create({ data: { phone: "+15550000081", role: "worker", workerProfile: { create: {} } } });
  workerToken = (await container.tokens.issuePair(w.id, "worker")).accessToken;
  const o = await prisma.user.create({ data: { phone: "+15550000082", role: "worker", workerProfile: { create: {} } } });
  outsiderToken = (await container.tokens.issuePair(o.id, "worker")).accessToken;
  const trade = await prisma.trade.findFirstOrThrow({ where: { slug: "cleaning" } });
  const job = await prisma.job.create({
    data: { clientId: c.id, tradeId: trade.id, title: "T", description: "1234567890", address: "x", lat: 47.6, lng: -122.3, urgency: "now" },
  });
  jobId = job.id;
  await prisma.quote.create({ data: { jobId, workerId: w.id, amountCents: 10000 } });
});

afterAll(() => app.close());

describe("messages", () => {
  it("client posts message", async () => {
    const res = await app.inject({
      method: "POST", url: `/jobs/${jobId}/messages`,
      headers: { authorization: `Bearer ${clientToken}` },
      payload: { body: "When can you start?" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("quoting worker posts message", async () => {
    const res = await app.inject({
      method: "POST", url: `/jobs/${jobId}/messages`,
      headers: { authorization: `Bearer ${workerToken}` },
      payload: { body: "Tomorrow 9am works" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("outsider worker forbidden", async () => {
    const res = await app.inject({
      method: "POST", url: `/jobs/${jobId}/messages`,
      headers: { authorization: `Bearer ${outsiderToken}` },
      payload: { body: "hi" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET returns chronological history", async () => {
    const res = await app.inject({
      method: "GET", url: `/jobs/${jobId}/messages`,
      headers: { authorization: `Bearer ${clientToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBe(2);
  });
});
```

- [ ] **Step 2: Implement**

```ts
import type { FastifyInstance } from "fastify";
import { PostMessageSchema } from "@cleansmart/shared";
import { requireAuth } from "../middleware/auth";

export async function messageRoutes(app: FastifyInstance) {
  const { prisma } = app.container;

  async function canAccessThread(jobId: string, userId: string, role: string): Promise<boolean> {
    if (role === "admin") return true;
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return false;
    if (job.clientId === userId) return true;
    const quote = await prisma.quote.findFirst({ where: { jobId, workerId: userId } });
    return !!quote;
  }

  app.post("/jobs/:id/messages", { preHandler: requireAuth }, async (req, reply) => {
    const jobId = (req.params as any).id;
    const body = PostMessageSchema.parse(req.body);
    if (!(await canAccessThread(jobId, req.userId!, req.userRole!))) {
      return reply.status(403).send({ error: { code: "forbidden", message: "Not part of this thread" } });
    }
    const msg = await prisma.message.create({
      data: { jobId, senderId: req.userId!, body: body.body },
    });
    app.container.realtime?.broadcastMessage(jobId, msg);
    reply.status(201);
    return msg;
  });

  app.get("/jobs/:id/messages", { preHandler: requireAuth }, async (req, reply) => {
    const jobId = (req.params as any).id;
    if (!(await canAccessThread(jobId, req.userId!, req.userRole!))) {
      return reply.status(403).send({ error: { code: "forbidden", message: "Not part of this thread" } });
    }
    return prisma.message.findMany({
      where: { jobId },
      orderBy: { createdAt: "asc" },
      include: { sender: { select: { id: true, name: true, avatarUrl: true, role: true } } },
      take: 200,
    });
  });
}
```

- [ ] **Step 3: Wire and pass**

Add `import { messageRoutes } from "./routes/messages";` and `app.register(messageRoutes);`. The `realtime?.broadcastMessage` will be added in next task — for now declare an optional `realtime` on container with type stub.

In `container.ts`:
```ts
import type { RealtimeService } from "./services/realtime";
// in interface: realtime?: RealtimeService;
```

Create empty `apps/api/src/services/realtime.ts`:
```ts
export interface RealtimeService {
  broadcastMessage(jobId: string, msg: unknown): void;
  broadcastQuote(jobId: string, quote: unknown): void;
}
```

Run: `pnpm --filter @cleansmart/api test`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/
git commit -m "feat(api): messaging routes per-job with access control"
```

---

### Task 8: Socket.io realtime — `/jobs/:id` room with JWT auth

**Files:**
- Create: `apps/api/src/services/realtime.ts` (replace stub)
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/container.ts`
- Create: `apps/api/src/services/__tests__/realtime.test.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Add deps**

Run: `pnpm --filter @cleansmart/api add socket.io@4.7.5`
Run: `pnpm --filter @cleansmart/api add -D socket.io-client@4.7.5`

- [ ] **Step 2: Replace realtime.ts**

```ts
import type { Server as HttpServer } from "node:http";
import { Server as IOServer, type Socket } from "socket.io";
import type { TokenService } from "./tokens";
import type { PrismaClient } from "@cleansmart/db";

export interface RealtimeService {
  broadcastMessage(jobId: string, msg: unknown): void;
  broadcastQuote(jobId: string, quote: unknown): void;
  io: IOServer;
}

export function attachRealtime(httpServer: HttpServer, tokens: TokenService, prisma: PrismaClient): RealtimeService {
  const io = new IOServer(httpServer, { cors: { origin: true } });

  io.use(async (socket: Socket, next) => {
    try {
      const token = (socket.handshake.auth as any)?.token;
      if (!token) return next(new Error("unauthorized"));
      const claims = tokens.verifyAccess(token);
      (socket.data as any).userId = claims.sub;
      (socket.data as any).role = claims.role;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("join", async (jobId: string) => {
      const userId = (socket.data as any).userId as string;
      const role = (socket.data as any).role as string;
      const job = await prisma.job.findUnique({ where: { id: jobId } });
      if (!job) return;
      let allowed = false;
      if (role === "admin" || job.clientId === userId) allowed = true;
      else {
        const quote = await prisma.quote.findFirst({ where: { jobId, workerId: userId } });
        allowed = !!quote;
      }
      if (allowed) socket.join(`job:${jobId}`);
    });
  });

  return {
    io,
    broadcastMessage(jobId, msg) { io.to(`job:${jobId}`).emit("message", msg); },
    broadcastQuote(jobId, quote) { io.to(`job:${jobId}`).emit("quote", quote); },
  };
}
```

- [ ] **Step 3: Update server.ts**

```ts
import "dotenv/config";
import { createServer } from "node:http";
import * as Sentry from "@sentry/node";
import { parseEnv } from "@cleansmart/shared";
import { buildApp } from "./app";
import { buildContainer } from "./container";
import { attachRealtime } from "./services/realtime";

const env = parseEnv(process.env);
if (env.SENTRY_DSN) {
  Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV, tracesSampleRate: 0.1 });
}

const container = buildContainer(env);
const app = buildApp(container);

await app.ready();
const httpServer = app.server;
const realtime = attachRealtime(httpServer, container.tokens, container.prisma);
container.realtime = realtime;

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Realtime integration test**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import { io as ioc } from "socket.io-client";
import { attachRealtime } from "../realtime";
import { buildContainer } from "../../container";
import { getPrisma } from "@cleansmart/db";

const container = buildContainer();
const prisma = getPrisma();
const httpServer = createServer();
const realtime = attachRealtime(httpServer, container.tokens, prisma);
let port: number;

beforeAll(async () => {
  await new Promise<void>((res) => httpServer.listen(0, () => res()));
  port = (httpServer.address() as any).port;
});

afterAll(async () => {
  realtime.io.close();
  await new Promise<void>((res) => httpServer.close(() => res()));
});

describe("realtime", () => {
  it("rejects connection without token", async () => {
    const client = ioc(`http://localhost:${port}`, { transports: ["websocket"], reconnection: false });
    await new Promise<void>((res) => client.on("connect_error", () => { client.close(); res(); }));
  });

  it("client receives broadcast on joined room", async () => {
    // setup client + job + quoting worker
    const c = await prisma.user.upsert({
      where: { phone: "+15550000090" }, update: {},
      create: { phone: "+15550000090", role: "client", clientProfile: { create: {} } },
    });
    const trade = await prisma.trade.findFirstOrThrow({ where: { slug: "cleaning" } });
    const job = await prisma.job.create({
      data: { clientId: c.id, tradeId: trade.id, title: "T", description: "1234567890",
              address: "x", lat: 47.6, lng: -122.3, urgency: "now" },
    });
    const pair = await container.tokens.issuePair(c.id, "client");
    const client = ioc(`http://localhost:${port}`, {
      transports: ["websocket"], reconnection: false,
      auth: { token: pair.accessToken },
    });
    await new Promise<void>((res) => client.on("connect", () => res()));
    client.emit("join", job.id);
    await new Promise((r) => setTimeout(r, 50));
    const got = new Promise<any>((res) => client.on("message", (m) => res(m)));
    realtime.broadcastMessage(job.id, { id: "m1", body: "hi" });
    const m = await got;
    expect(m.id).toBe("m1");
    client.close();
  });
});
```

- [ ] **Step 5: Run, pass, commit**

Run: `pnpm --filter @cleansmart/api test`

```bash
git add apps/api/ pnpm-lock.yaml
git commit -m "feat(api): socket.io realtime with JWT auth and per-job rooms"
```

---

### Task 9: Quote-created push to client

**Files:**
- Modify: `apps/api/src/routes/quotes.ts`

- [ ] **Step 1: Enqueue push on POST quote**

After successful quote creation in `quoteRoutes`:

```ts
import { makeQueue } from "../queue";
// ...
const pushQueue = makeQueue("push", app.container.env.REDIS_URL);
const tokens = await prisma.expoPushToken.findMany({ where: { userId: job.clientId } });
if (tokens.length > 0) {
  await pushQueue.add("send", tokens.map((t) => ({
    token: t.token,
    title: "New quote received",
    body: `$${(quote.amountCents / 100).toFixed(2)} — tap to view`,
    data: { type: "new_quote", jobId, quoteId: quote.id },
  })));
}
app.container.realtime?.broadcastQuote(jobId, quote);
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/
git commit -m "feat(api): push notify client on new quote and broadcast realtime"
```

---

## Done criteria

- Workers can quote, list, and withdraw; clients can view quotes for their jobs.
- Per-job message threads work with access control (client + quoting workers only).
- Socket.io connects with JWT, joins per-job rooms, and broadcasts messages and quotes.
- Posting a job enqueues fan-out → push notifications to up to 50 nearest matched workers.
- Posting a quote pushes the client.
- All tested; CI green.
