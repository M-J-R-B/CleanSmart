# CleanSmart Bookings & Escrow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stripe Connect onboarding for workers; client accepts a quote, pays into escrow; lifecycle (start/complete/release); 48h auto-release via BullMQ delayed job.

**Architecture:** Workers create Stripe Connect Express accounts during onboarding. Accepting a quote creates a `Booking` and a Stripe `PaymentIntent` with `application_fee_amount` and `transfer_data.destination` to the worker's connected account. Funds are held by Stripe until release; on release we capture or rely on Stripe's automatic transfer at confirmation depending on flow. We use **manual capture** so we control when funds move.

**Tech Stack:** Stripe Node SDK, Stripe Connect Express, BullMQ delayed jobs, Fastify, Prisma transactions.

**Depends on:** Plans 1-4 complete.

---

### Task 1: Schema — Booking + BookingStatus

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add Booking model**

```prisma
enum BookingStatus {
  pending_payment
  funded
  started
  completed
  released
  refunded
  disputed
}

model Booking {
  id                       String        @id @default(uuid()) @db.Uuid
  jobId                    String        @unique @map("job_id") @db.Uuid
  quoteId                  String        @unique @map("quote_id") @db.Uuid
  clientId                 String        @map("client_id") @db.Uuid
  workerId                 String        @map("worker_id") @db.Uuid
  amountCents              Int           @map("amount_cents")
  platformFeeCents         Int           @map("platform_fee_cents")
  tipCents                 Int           @default(0) @map("tip_cents")
  escrowPaymentIntentId    String?       @map("escrow_payment_intent_id")
  tipPaymentIntentId       String?       @map("tip_payment_intent_id")
  status                   BookingStatus @default(pending_payment)
  startedAt                DateTime?     @map("started_at")
  completedAt              DateTime?     @map("completed_at")
  releasedAt               DateTime?     @map("released_at")
  autoReleaseJobId         String?       @map("auto_release_job_id")
  createdAt                DateTime      @default(now()) @map("created_at")
  updatedAt                DateTime      @updatedAt @map("updated_at")

  job    Job   @relation(fields: [jobId], references: [id])
  quote  Quote @relation(fields: [quoteId], references: [id])
  client User  @relation("clientBookings", fields: [clientId], references: [id])
  worker User  @relation("workerBookings", fields: [workerId], references: [id])

  @@index([clientId])
  @@index([workerId])
  @@index([status])
  @@map("bookings")
}
```

- [ ] **Step 2: Add back-relations**

In `User`:
```prisma
clientBookings Booking[] @relation("clientBookings")
workerBookings Booking[] @relation("workerBookings")
```

In `Job`:
```prisma
booking Booking?
```

In `Quote`:
```prisma
booking Booking?
```

- [ ] **Step 3: Migrate**

Run: `pnpm --filter @cleansmart/db prisma:migrate:dev --name bookings`

- [ ] **Step 4: Commit**

```bash
git add packages/db/
git commit -m "feat(db): add Booking model"
```

---

### Task 2: Stripe service wrapper

**Files:**
- Create: `apps/api/src/services/stripe.ts`
- Create: `apps/api/src/services/__tests__/stripe.test.ts`
- Modify: `packages/shared/src/env.ts`
- Modify: `apps/api/src/container.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Add deps + env vars**

Run: `pnpm --filter @cleansmart/api add stripe@15.4.0`

Edit `packages/shared/src/env.ts` add:
```ts
STRIPE_SECRET_KEY: z.string().min(10),
STRIPE_WEBHOOK_SECRET: z.string().min(10),
PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(5000).default(1500),
APP_BASE_URL: z.string().url().default("http://localhost:3000"),
```

Update env tests to provide these. Add to `apps/api/.env.example`:
```
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
PLATFORM_FEE_BPS=1500
APP_BASE_URL=http://localhost:3000
```

- [ ] **Step 2: Failing fee calc test**

```ts
import { describe, it, expect } from "vitest";
import { calcPlatformFeeCents } from "../stripe";

describe("calcPlatformFeeCents", () => {
  it("returns 15% of 10000 = 1500", () => {
    expect(calcPlatformFeeCents(10000, 1500)).toBe(1500);
  });
  it("rounds down on fractional cents", () => {
    expect(calcPlatformFeeCents(333, 1500)).toBe(49);
  });
  it("returns 0 for 0 amount", () => {
    expect(calcPlatformFeeCents(0, 1500)).toBe(0);
  });
});
```

- [ ] **Step 3: Implement stripe.ts**

```ts
import Stripe from "stripe";

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  platformFeeBps: number;
  appBaseUrl: string;
}

export function calcPlatformFeeCents(amountCents: number, bps: number): number {
  return Math.floor((amountCents * bps) / 10000);
}

export function createStripeService(cfg: StripeConfig) {
  const stripe = new Stripe(cfg.secretKey, { apiVersion: "2024-04-10" });

  return {
    raw: stripe,

    async createConnectAccount(userId: string, email: string | null): Promise<string> {
      const acct = await stripe.accounts.create({
        type: "express",
        capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
        metadata: { userId },
        email: email ?? undefined,
      });
      return acct.id;
    },

    async createOnboardingLink(accountId: string): Promise<string> {
      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${cfg.appBaseUrl}/connect/refresh`,
        return_url: `${cfg.appBaseUrl}/connect/return`,
        type: "account_onboarding",
      });
      return link.url;
    },

    async createEscrowPaymentIntent(params: {
      amountCents: number;
      destinationAccountId: string;
      bookingId: string;
      customerId?: string;
    }) {
      const fee = calcPlatformFeeCents(params.amountCents, cfg.platformFeeBps);
      return stripe.paymentIntents.create({
        amount: params.amountCents,
        currency: "usd",
        capture_method: "manual",
        application_fee_amount: fee,
        transfer_data: { destination: params.destinationAccountId },
        metadata: { bookingId: params.bookingId, kind: "escrow" },
      });
    },

    async capturePaymentIntent(paymentIntentId: string) {
      return stripe.paymentIntents.capture(paymentIntentId);
    },

    async cancelPaymentIntent(paymentIntentId: string) {
      return stripe.paymentIntents.cancel(paymentIntentId);
    },

    async refundPaymentIntent(paymentIntentId: string) {
      return stripe.refunds.create({ payment_intent: paymentIntentId });
    },

    async createTipCharge(params: {
      amountCents: number;
      destinationAccountId: string;
      bookingId: string;
    }) {
      return stripe.paymentIntents.create({
        amount: params.amountCents,
        currency: "usd",
        application_fee_amount: 0,
        transfer_data: { destination: params.destinationAccountId },
        metadata: { bookingId: params.bookingId, kind: "tip" },
      });
    },

    constructWebhookEvent(rawBody: string | Buffer, sig: string) {
      return stripe.webhooks.constructEvent(rawBody, sig, cfg.webhookSecret);
    },
  };
}

export type StripeService = ReturnType<typeof createStripeService>;
```

- [ ] **Step 4: Add to container**

```ts
import { createStripeService, type StripeService } from "./services/stripe";
// in interface: stripe: StripeService;
const stripe = createStripeService({
  secretKey: env.STRIPE_SECRET_KEY,
  webhookSecret: env.STRIPE_WEBHOOK_SECRET,
  platformFeeBps: env.PLATFORM_FEE_BPS,
  appBaseUrl: env.APP_BASE_URL,
});
return { ..., stripe };
```

- [ ] **Step 5: Add test env vars in CI**

Edit `.github/workflows/ci.yml` env block:
```
STRIPE_SECRET_KEY: sk_test_dummy
STRIPE_WEBHOOK_SECRET: whsec_dummy
PLATFORM_FEE_BPS: 1500
APP_BASE_URL: http://localhost:3000
```

- [ ] **Step 6: Run, pass, commit**

```bash
git add apps/api/ packages/shared/ .github/ pnpm-lock.yaml
git commit -m "feat(api): stripe service wrapper with platform fee calc"
```

---

### Task 3: Worker Connect onboarding — POST /me/worker/connect/account, /link

**Files:**
- Modify: `apps/api/src/routes/me.ts`
- Modify: `apps/api/src/routes/__tests__/me.test.ts`

- [ ] **Step 1: Implement endpoints**

Append to `meRoutes`:

```ts
app.post("/me/worker/connect/account", { preHandler: [requireAuth, requireRole("worker")] }, async (req) => {
  const wp = await prisma.workerProfile.findUniqueOrThrow({
    where: { userId: req.userId! }, include: { user: true },
  });
  let accountId = wp.stripeAccountId;
  if (!accountId) {
    accountId = await app.container.stripe.createConnectAccount(req.userId!, wp.user.email);
    await prisma.workerProfile.update({ where: { userId: req.userId! }, data: { stripeAccountId: accountId } });
  }
  const url = await app.container.stripe.createOnboardingLink(accountId);
  return { accountId, onboardingUrl: url };
});
```

- [ ] **Step 2: Test (mock stripe)**

```ts
it("POST /me/worker/connect/account returns onboarding URL", async () => {
  container.stripe.createConnectAccount = vi.fn(async () => "acct_test_123") as any;
  container.stripe.createOnboardingLink = vi.fn(async () => "https://stripe/onboard") as any;
  const res = await app.inject({
    method: "POST", url: "/me/worker/connect/account",
    headers: { authorization: `Bearer ${workerToken}` },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.onboardingUrl).toContain("stripe");
});
```

- [ ] **Step 3: Run, commit**

```bash
git add apps/api/src/
git commit -m "feat(api): worker Stripe Connect account creation + onboarding link"
```

---

### Task 4: POST /quotes/:id/accept — create booking + payment intent

**Files:**
- Create: `apps/api/src/routes/bookings.ts`
- Create: `apps/api/src/routes/__tests__/bookings.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildApp } from "../../app";
import { buildContainer } from "../../container";
import { getPrisma } from "@cleansmart/db";

const container = buildContainer();
container.stripe.createEscrowPaymentIntent = vi.fn(async (p) => ({
  id: "pi_test_" + p.bookingId.slice(0, 6),
  client_secret: "secret_xxx",
} as any));
container.stripe.capturePaymentIntent = vi.fn(async (id) => ({ id, status: "succeeded" } as any));
container.stripe.cancelPaymentIntent = vi.fn(async () => ({} as any));

const app = buildApp(container);
const prisma = getPrisma();

let clientToken: string, workerId: string, quoteId: string, jobId: string;

beforeAll(async () => {
  await prisma.booking.deleteMany();
  await prisma.quote.deleteMany();
  await prisma.job.deleteMany();
  await prisma.user.deleteMany({ where: { phone: { in: ["+15550000100","+15550000101"] } } });
  const c = await prisma.user.create({ data: { phone: "+15550000100", role: "client", clientProfile: { create: {} } } });
  clientToken = (await container.tokens.issuePair(c.id, "client")).accessToken;
  const w = await prisma.user.create({
    data: { phone: "+15550000101", role: "worker",
            workerProfile: { create: { stripeAccountId: "acct_test_w1", verifiedAt: new Date() } } },
  });
  workerId = w.id;
  const trade = await prisma.trade.findFirstOrThrow({ where: { slug: "cleaning" } });
  const job = await prisma.job.create({
    data: { clientId: c.id, tradeId: trade.id, title: "T", description: "1234567890",
            address: "x", lat: 47.6, lng: -122.3, urgency: "now" },
  });
  jobId = job.id;
  const q = await prisma.quote.create({ data: { jobId, workerId, amountCents: 12000 } });
  quoteId = q.id;
});

afterAll(() => app.close());

describe("accept quote", () => {
  it("POST /quotes/:id/accept creates booking + PI, returns client_secret", async () => {
    const res = await app.inject({
      method: "POST", url: `/quotes/${quoteId}/accept`,
      headers: { authorization: `Bearer ${clientToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.clientSecret).toBeTruthy();
    expect(body.bookingId).toBeTruthy();
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: body.bookingId } });
    expect(booking.status).toBe("pending_payment");
    expect(booking.amountCents).toBe(12000);
    expect(booking.platformFeeCents).toBe(1800);
  });

  it("rejects accept by non-owner", async () => {
    const w2 = await prisma.user.create({ data: { phone: "+15550000102", role: "worker", workerProfile: { create: {} } } });
    const pair = await container.tokens.issuePair(w2.id, "worker");
    const res = await app.inject({
      method: "POST", url: `/quotes/${quoteId}/accept`,
      headers: { authorization: `Bearer ${pair.accessToken}` },
    });
    expect([403, 409]).toContain(res.statusCode);
  });

  it("rejects accept when worker has no Stripe account", async () => {
    const w3 = await prisma.user.create({ data: { phone: "+15550000103", role: "worker", workerProfile: { create: {} } } });
    const trade = await prisma.trade.findFirstOrThrow({ where: { slug: "cleaning" } });
    const c2 = await prisma.user.upsert({ where: { phone: "+15550000104" }, update: {}, create: { phone: "+15550000104", role: "client", clientProfile: { create: {} } } });
    const tok = (await container.tokens.issuePair(c2.id, "client")).accessToken;
    const job2 = await prisma.job.create({ data: { clientId: c2.id, tradeId: trade.id, title: "T", description: "1234567890", address: "x", lat: 0, lng: 0, urgency: "now" } });
    const q2 = await prisma.quote.create({ data: { jobId: job2.id, workerId: w3.id, amountCents: 5000 } });
    const res = await app.inject({
      method: "POST", url: `/quotes/${q2.id}/accept`,
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(res.statusCode).toBe(409);
  });
});
```

- [ ] **Step 2: Implement bookings.ts**

```ts
import type { FastifyInstance } from "fastify";
import { calcPlatformFeeCents } from "../services/stripe";
import { requireAuth, requireRole } from "../middleware/auth";

export async function bookingRoutes(app: FastifyInstance) {
  const { prisma, stripe, env } = app.container;

  app.post("/quotes/:id/accept", { preHandler: [requireAuth, requireRole("client")] }, async (req, reply) => {
    const quoteId = (req.params as any).id;
    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      include: { job: true, worker: { include: { workerProfile: true } } },
    });
    if (!quote) return reply.status(404).send({ error: { code: "not_found", message: "Quote not found" } });
    if (quote.job.clientId !== req.userId) return reply.status(403).send({ error: { code: "forbidden", message: "Not your job" } });
    if (quote.status !== "pending") return reply.status(409).send({ error: { code: "invalid_state", message: "Quote not pending" } });
    if (!quote.worker.workerProfile?.stripeAccountId) {
      return reply.status(409).send({ error: { code: "worker_not_onboarded", message: "Worker has not completed payment setup" } });
    }
    if (quote.job.status !== "open" && quote.job.status !== "quoted") {
      return reply.status(409).send({ error: { code: "job_closed", message: "Job is no longer accepting quotes" } });
    }

    const platformFee = calcPlatformFeeCents(quote.amountCents, env.PLATFORM_FEE_BPS);

    // Pre-create booking row in pending_payment so we have an ID for metadata
    const booking = await prisma.booking.create({
      data: {
        jobId: quote.jobId, quoteId: quote.id, clientId: quote.job.clientId,
        workerId: quote.workerId, amountCents: quote.amountCents,
        platformFeeCents: platformFee, status: "pending_payment",
      },
    });

    let pi;
    try {
      pi = await stripe.createEscrowPaymentIntent({
        amountCents: quote.amountCents,
        destinationAccountId: quote.worker.workerProfile.stripeAccountId,
        bookingId: booking.id,
      });
    } catch (err) {
      await prisma.booking.delete({ where: { id: booking.id } });
      throw err;
    }

    await prisma.booking.update({
      where: { id: booking.id },
      data: { escrowPaymentIntentId: pi.id },
    });

    return { bookingId: booking.id, clientSecret: pi.client_secret, paymentIntentId: pi.id };
  });
}
```

- [ ] **Step 3: Wire and run**

Add `import { bookingRoutes } from "./routes/bookings";` and `app.register(bookingRoutes);`.

Run: `pnpm --filter @cleansmart/api test`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/
git commit -m "feat(api): accept quote -> booking + escrow PaymentIntent"
```

---

### Task 5: Stripe webhook handler — payment_intent.succeeded → booking funded + accept_quote side effects

**Files:**
- Create: `apps/api/src/routes/stripe-webhooks.ts`
- Create: `apps/api/src/routes/__tests__/stripe-webhooks.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Implement webhook**

```ts
import type { FastifyInstance } from "fastify";

export async function stripeWebhookRoutes(app: FastifyInstance) {
  const { prisma, stripe } = app.container;

  app.post("/webhooks/stripe", { config: { rawBody: true } }, async (req, reply) => {
    const sig = req.headers["stripe-signature"] as string | undefined;
    const raw = (req as any).rawBody as string | Buffer | undefined;
    if (!sig || !raw) return reply.status(400).send({ error: { code: "bad_request", message: "Missing signature" } });

    let event;
    try {
      event = stripe.constructWebhookEvent(raw, sig);
    } catch (err) {
      app.log.warn({ err }, "Stripe webhook signature failed");
      return reply.status(401).send({ error: { code: "bad_signature", message: "Invalid signature" } });
    }

    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object as any;
        const bookingId = pi.metadata?.bookingId as string | undefined;
        const kind = pi.metadata?.kind as string | undefined;
        if (!bookingId) break;
        if (kind === "escrow") {
          await prisma.$transaction(async (tx) => {
            const booking = await tx.booking.findUnique({ where: { id: bookingId } });
            if (!booking || booking.status !== "pending_payment") return;
            await tx.booking.update({ where: { id: bookingId }, data: { status: "funded" } });
            await tx.job.update({ where: { id: booking.jobId }, data: { status: "accepted", acceptedQuoteId: booking.quoteId } });
            await tx.quote.update({ where: { id: booking.quoteId }, data: { status: "accepted" } });
            await tx.quote.updateMany({
              where: { jobId: booking.jobId, id: { not: booking.quoteId }, status: "pending" },
              data: { status: "rejected" },
            });
          });
        } else if (kind === "tip") {
          const amount = pi.amount_received as number;
          await prisma.booking.update({ where: { id: bookingId }, data: { tipCents: amount, tipPaymentIntentId: pi.id } });
        }
        break;
      }
      case "payment_intent.canceled":
      case "payment_intent.payment_failed": {
        const pi = event.data.object as any;
        const bookingId = pi.metadata?.bookingId as string | undefined;
        if (!bookingId) break;
        await prisma.booking.updateMany({
          where: { id: bookingId, status: "pending_payment" },
          data: { status: "refunded" },
        });
        break;
      }
    }
    reply.status(200).send({ received: true });
  });
}
```

- [ ] **Step 2: Wire**

Add `import { stripeWebhookRoutes } from "./routes/stripe-webhooks";` and `app.register(stripeWebhookRoutes);`.

- [ ] **Step 3: Test (using a stubbed `constructWebhookEvent`)**

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildApp } from "../../app";
import { buildContainer } from "../../container";
import { getPrisma } from "@cleansmart/db";

const container = buildContainer();
const stubbedEvent: any = { type: "payment_intent.succeeded", data: { object: { id: "pi_test", metadata: {}, amount_received: 0 } } };
container.stripe.constructWebhookEvent = vi.fn(() => stubbedEvent) as any;
const app = buildApp(container);
const prisma = getPrisma();

let bookingId: string;

beforeAll(async () => {
  await prisma.booking.deleteMany();
  await prisma.quote.deleteMany();
  await prisma.job.deleteMany();
  await prisma.user.deleteMany({ where: { phone: { in: ["+15550000110","+15550000111"] } } });
  const c = await prisma.user.create({ data: { phone: "+15550000110", role: "client", clientProfile: { create: {} } } });
  const w = await prisma.user.create({ data: { phone: "+15550000111", role: "worker", workerProfile: { create: { stripeAccountId: "acct_test", verifiedAt: new Date() } } } });
  const trade = await prisma.trade.findFirstOrThrow({ where: { slug: "cleaning" } });
  const job = await prisma.job.create({ data: { clientId: c.id, tradeId: trade.id, title: "T", description: "1234567890", address: "x", lat: 0, lng: 0, urgency: "now" } });
  const q = await prisma.quote.create({ data: { jobId: job.id, workerId: w.id, amountCents: 10000 } });
  const b = await prisma.booking.create({ data: {
    jobId: job.id, quoteId: q.id, clientId: c.id, workerId: w.id,
    amountCents: 10000, platformFeeCents: 1500,
    escrowPaymentIntentId: "pi_test", status: "pending_payment",
  }});
  bookingId = b.id;
  stubbedEvent.data.object.metadata = { bookingId, kind: "escrow" };
});

afterAll(() => app.close());

describe("stripe webhook", () => {
  it("payment_intent.succeeded transitions booking to funded", async () => {
    const res = await app.inject({
      method: "POST", url: "/webhooks/stripe",
      headers: { "stripe-signature": "test" },
      payload: "{}",
    });
    expect(res.statusCode).toBe(200);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(b.status).toBe("funded");
  });
});
```

- [ ] **Step 4: Run, commit**

```bash
git add apps/api/src/
git commit -m "feat(api): stripe webhook handles escrow funded transition"
```

---

### Task 6: Booking lifecycle endpoints — start, complete, release, cancel

**Files:**
- Modify: `apps/api/src/routes/bookings.ts`
- Modify: `apps/api/src/routes/__tests__/bookings.test.ts`

- [ ] **Step 1: Implement endpoints**

Append to `bookingRoutes`:

```ts
app.get("/bookings/:id", { preHandler: requireAuth }, async (req, reply) => {
  const id = (req.params as any).id;
  const b = await prisma.booking.findUnique({
    where: { id },
    include: { job: true, quote: true, client: true, worker: true },
  });
  if (!b) return reply.status(404).send({ error: { code: "not_found", message: "Booking not found" } });
  if (b.clientId !== req.userId && b.workerId !== req.userId && req.userRole !== "admin") {
    return reply.status(403).send({ error: { code: "forbidden", message: "Not your booking" } });
  }
  return b;
});

app.post("/bookings/:id/start", { preHandler: [requireAuth, requireRole("worker")] }, async (req, reply) => {
  const id = (req.params as any).id;
  const b = await prisma.booking.findUnique({ where: { id } });
  if (!b || b.workerId !== req.userId) return reply.status(404).send({ error: { code: "not_found", message: "Not found" } });
  if (b.status !== "funded") return reply.status(409).send({ error: { code: "invalid_state", message: `Cannot start from ${b.status}` } });
  const updated = await prisma.booking.update({
    where: { id }, data: { status: "started", startedAt: new Date() },
  });
  await prisma.job.update({ where: { id: b.jobId }, data: { status: "in_progress" } });
  return updated;
});

app.post("/bookings/:id/complete", { preHandler: [requireAuth, requireRole("worker")] }, async (req, reply) => {
  const id = (req.params as any).id;
  const b = await prisma.booking.findUnique({ where: { id } });
  if (!b || b.workerId !== req.userId) return reply.status(404).send({ error: { code: "not_found", message: "Not found" } });
  if (b.status !== "started") return reply.status(409).send({ error: { code: "invalid_state", message: `Cannot complete from ${b.status}` } });
  const updated = await prisma.booking.update({
    where: { id }, data: { status: "completed", completedAt: new Date() },
  });
  // schedule auto-release in 48h via BullMQ delayed job (next task)
  await app.container.escrowQueue?.add("auto-release", { bookingId: id }, { delay: 48 * 60 * 60 * 1000 });
  return updated;
});

app.post("/bookings/:id/release", { preHandler: [requireAuth, requireRole("client", "admin")] }, async (req, reply) => {
  const id = (req.params as any).id;
  const b = await prisma.booking.findUnique({ where: { id } });
  if (!b) return reply.status(404).send({ error: { code: "not_found", message: "Not found" } });
  if (req.userRole === "client" && b.clientId !== req.userId) {
    return reply.status(403).send({ error: { code: "forbidden", message: "Not your booking" } });
  }
  if (b.status !== "completed") return reply.status(409).send({ error: { code: "invalid_state", message: `Cannot release from ${b.status}` } });
  if (!b.escrowPaymentIntentId) return reply.status(409).send({ error: { code: "no_pi", message: "Missing PaymentIntent" } });
  await stripe.capturePaymentIntent(b.escrowPaymentIntentId);
  const updated = await prisma.booking.update({
    where: { id }, data: { status: "released", releasedAt: new Date() },
  });
  await prisma.job.update({ where: { id: b.jobId }, data: { status: "completed" } });
  return updated;
});

app.post("/bookings/:id/cancel", { preHandler: [requireAuth, requireRole("client", "admin")] }, async (req, reply) => {
  const id = (req.params as any).id;
  const b = await prisma.booking.findUnique({ where: { id } });
  if (!b) return reply.status(404).send({ error: { code: "not_found", message: "Not found" } });
  if (req.userRole === "client" && b.clientId !== req.userId) {
    return reply.status(403).send({ error: { code: "forbidden", message: "Not your booking" } });
  }
  if (!["pending_payment", "funded"].includes(b.status)) {
    return reply.status(409).send({ error: { code: "invalid_state", message: "Cancel via dispute after work has started" } });
  }
  if (b.escrowPaymentIntentId) {
    if (b.status === "funded") await stripe.refundPaymentIntent(b.escrowPaymentIntentId);
    else await stripe.cancelPaymentIntent(b.escrowPaymentIntentId);
  }
  await prisma.$transaction([
    prisma.booking.update({ where: { id }, data: { status: "refunded" } }),
    prisma.job.update({ where: { id: b.jobId }, data: { status: "cancelled" } }),
  ]);
  reply.status(204).send();
});
```

Add `escrowQueue?: import("bullmq").Queue` to Container interface.

- [ ] **Step 2: Add full lifecycle test**

```ts
it("full lifecycle: start -> complete -> release", async () => {
  // assumes prior accept-test set bookingId variable
  const accept = await app.inject({
    method: "POST", url: `/quotes/${quoteId}/accept`,
    headers: { authorization: `Bearer ${clientToken}` },
  });
  const { bookingId } = accept.json();
  await prisma.booking.update({ where: { id: bookingId }, data: { status: "funded" } });

  const workerPair = await container.tokens.issuePair(workerId, "worker");
  const wTok = workerPair.accessToken;

  const start = await app.inject({ method: "POST", url: `/bookings/${bookingId}/start`, headers: { authorization: `Bearer ${wTok}` } });
  expect(start.statusCode).toBe(200);
  const complete = await app.inject({ method: "POST", url: `/bookings/${bookingId}/complete`, headers: { authorization: `Bearer ${wTok}` } });
  expect(complete.statusCode).toBe(200);
  const release = await app.inject({ method: "POST", url: `/bookings/${bookingId}/release`, headers: { authorization: `Bearer ${clientToken}` } });
  expect(release.statusCode).toBe(200);
  const final = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  expect(final.status).toBe("released");
});
```

- [ ] **Step 3: Run, commit**

```bash
git add apps/api/src/
git commit -m "feat(api): booking lifecycle (start/complete/release/cancel)"
```

---

### Task 7: 48h auto-release worker

**Files:**
- Create: `apps/api/src/queue/escrow-auto-release.ts`
- Modify: `apps/api/src/workers/index.ts`
- Modify: `apps/api/src/container.ts`

- [ ] **Step 1: Add escrowQueue to container**

```ts
import { makeQueue } from "./queue";
// in buildContainer:
const escrowQueue = makeQueue<{ bookingId: string }>("escrow-auto-release", env.REDIS_URL);
return { ..., escrowQueue };
```

- [ ] **Step 2: Implement worker fn**

```ts
import type { PrismaClient } from "@cleansmart/db";
import type { StripeService } from "../services/stripe";

export async function autoReleaseBooking(prisma: PrismaClient, stripe: StripeService, bookingId: string) {
  const b = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!b) return;
  if (b.status !== "completed") return; // already released, disputed, etc.
  if (!b.escrowPaymentIntentId) return;
  await stripe.capturePaymentIntent(b.escrowPaymentIntentId);
  await prisma.$transaction([
    prisma.booking.update({ where: { id: bookingId }, data: { status: "released", releasedAt: new Date() } }),
    prisma.job.update({ where: { id: b.jobId }, data: { status: "completed" } }),
  ]);
}
```

- [ ] **Step 3: Wire into workers/index.ts**

```ts
import { autoReleaseBooking } from "../queue/escrow-auto-release";
import { createStripeService } from "../services/stripe";

const stripe = createStripeService({
  secretKey: env.STRIPE_SECRET_KEY,
  webhookSecret: env.STRIPE_WEBHOOK_SECRET,
  platformFeeBps: env.PLATFORM_FEE_BPS,
  appBaseUrl: env.APP_BASE_URL,
});

makeWorker<{ bookingId: string }>("escrow-auto-release", env.REDIS_URL, async ({ data }) => {
  await autoReleaseBooking(prisma, stripe, data.bookingId);
});
```

- [ ] **Step 4: Test the function directly**

```ts
import { describe, it, expect, vi } from "vitest";
import { autoReleaseBooking } from "../escrow-auto-release";
import { getPrisma } from "@cleansmart/db";

const prisma = getPrisma();

describe("autoReleaseBooking", () => {
  it("captures PI and marks released for completed booking", async () => {
    // setup completed booking
    const c = await prisma.user.upsert({ where: { phone: "+15550000120" }, update: {}, create: { phone: "+15550000120", role: "client", clientProfile: { create: {} } } });
    const w = await prisma.user.upsert({ where: { phone: "+15550000121" }, update: {}, create: { phone: "+15550000121", role: "worker", workerProfile: { create: { stripeAccountId: "acct_x" } } } });
    const trade = await prisma.trade.findFirstOrThrow({ where: { slug: "cleaning" } });
    const j = await prisma.job.create({ data: { clientId: c.id, tradeId: trade.id, title: "T", description: "1234567890", address: "x", lat: 0, lng: 0, urgency: "now" } });
    const q = await prisma.quote.create({ data: { jobId: j.id, workerId: w.id, amountCents: 5000 } });
    const b = await prisma.booking.create({ data: {
      jobId: j.id, quoteId: q.id, clientId: c.id, workerId: w.id,
      amountCents: 5000, platformFeeCents: 750, status: "completed", escrowPaymentIntentId: "pi_x",
      completedAt: new Date(),
    }});

    const stripe = { capturePaymentIntent: vi.fn(async () => ({} as any)) } as any;
    await autoReleaseBooking(prisma, stripe, b.id);
    expect(stripe.capturePaymentIntent).toHaveBeenCalledWith("pi_x");
    const final = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(final.status).toBe("released");
  });

  it("no-op for non-completed booking", async () => {
    const stripe = { capturePaymentIntent: vi.fn() } as any;
    await autoReleaseBooking(prisma, stripe, "00000000-0000-0000-0000-000000000000");
    expect(stripe.capturePaymentIntent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run, commit**

```bash
git add apps/api/src/
git commit -m "feat(api): 48h escrow auto-release via BullMQ delayed job"
```

---

## Done criteria

- Workers can onboard via Stripe Connect Express.
- Clients accepting a quote create a `Booking` and a Stripe PaymentIntent (manual capture, with platform fee + transfer destination).
- Webhook flips `pending_payment` → `funded` on success; rejects other quotes; transitions `Job` to `accepted`.
- Worker can `start` then `complete`; client can `release` (captures the PI); cancellation refunds where appropriate.
- After `complete`, a delayed BullMQ job auto-releases at 48h.
- All flows tested with mocked Stripe; CI green.
