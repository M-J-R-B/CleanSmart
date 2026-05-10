# CleanSmart Tipping & Reviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Post-completion tipping (100% to worker, no platform fee) within 24h of release; two-way reviews with worker portfolio photos.

**Architecture:** Tip is a separate Stripe PaymentIntent with `application_fee_amount: 0` and `transfer_data.destination` to the worker's connected account. Reviews are gated on `booking.status = released`; worker review photos are stored in `reviews.photos[]` and surface as portfolio.

**Tech Stack:** Stripe, Prisma, Fastify.

**Depends on:** Plans 1-5 complete.

---

### Task 1: Schema — Review

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add Review model**

```prisma
enum ReviewDirection {
  client_to_worker
  worker_to_client
}

model Review {
  id        String          @id @default(uuid()) @db.Uuid
  bookingId String          @map("booking_id") @db.Uuid
  authorId  String          @map("author_id") @db.Uuid
  subjectId String          @map("subject_id") @db.Uuid
  direction ReviewDirection
  rating    Int
  comment   String?
  photos    String[]        @default([])
  createdAt DateTime        @default(now()) @map("created_at")

  booking Booking @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  author  User    @relation("authoredReviews", fields: [authorId], references: [id])
  subject User    @relation("receivedReviews", fields: [subjectId], references: [id])

  @@unique([bookingId, direction])
  @@index([subjectId])
  @@map("reviews")
}
```

- [ ] **Step 2: Back-relations**

In `User`:
```prisma
authoredReviews Review[] @relation("authoredReviews")
receivedReviews Review[] @relation("receivedReviews")
```

In `Booking`:
```prisma
reviews Review[]
```

- [ ] **Step 3: Migrate**

Run: `pnpm --filter @cleansmart/db prisma:migrate:dev --name reviews`

- [ ] **Step 4: Commit**

```bash
git add packages/db/
git commit -m "feat(db): add Review model with direction unique-per-booking"
```

---

### Task 2: Tip flow — POST /bookings/:id/tip

**Files:**
- Modify: `apps/api/src/routes/bookings.ts`
- Modify: `packages/shared/src/schemas/index.ts`
- Create: `packages/shared/src/schemas/tipping.ts`
- Modify: `apps/api/src/routes/__tests__/bookings.test.ts`

- [ ] **Step 1: Add schema**

Create `packages/shared/src/schemas/tipping.ts`:

```ts
import { z } from "zod";

export const TipSchema = z.object({
  amountCents: z.number().int().min(100).max(50_000),
});
export type Tip = z.infer<typeof TipSchema>;
```

Add `export * from "./tipping";` to schemas/index.ts.

- [ ] **Step 2: Failing test**

Append to bookings test:

```ts
describe("tipping", () => {
  it("POST /bookings/:id/tip allowed within 24h after release", async () => {
    container.stripe.createTipCharge = vi.fn(async (p) => ({
      id: "pi_tip_" + p.bookingId.slice(0, 6),
      client_secret: "tip_secret",
    } as any)) as any;

    // create a released booking
    const c = await prisma.user.upsert({ where: { phone: "+15550000130" }, update: {}, create: { phone: "+15550000130", role: "client", clientProfile: { create: {} } } });
    const w = await prisma.user.upsert({ where: { phone: "+15550000131" }, update: {}, create: { phone: "+15550000131", role: "worker", workerProfile: { create: { stripeAccountId: "acct_t" } } } });
    const trade = await prisma.trade.findFirstOrThrow({ where: { slug: "cleaning" } });
    const j = await prisma.job.create({ data: { clientId: c.id, tradeId: trade.id, title: "T", description: "1234567890", address: "x", lat: 0, lng: 0, urgency: "now", status: "completed" } });
    const q = await prisma.quote.create({ data: { jobId: j.id, workerId: w.id, amountCents: 8000 } });
    const b = await prisma.booking.create({ data: {
      jobId: j.id, quoteId: q.id, clientId: c.id, workerId: w.id,
      amountCents: 8000, platformFeeCents: 1200, status: "released",
      releasedAt: new Date(), escrowPaymentIntentId: "pi_main",
    }});
    const tok = (await container.tokens.issuePair(c.id, "client")).accessToken;

    const res = await app.inject({
      method: "POST", url: `/bookings/${b.id}/tip`,
      headers: { authorization: `Bearer ${tok}` },
      payload: { amountCents: 1000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().clientSecret).toBeTruthy();
    expect(container.stripe.createTipCharge).toHaveBeenCalledWith(expect.objectContaining({
      amountCents: 1000, destinationAccountId: "acct_t", bookingId: b.id,
    }));
  });

  it("rejects tip after 24h window", async () => {
    const c = await prisma.user.upsert({ where: { phone: "+15550000132" }, update: {}, create: { phone: "+15550000132", role: "client", clientProfile: { create: {} } } });
    const w = await prisma.user.upsert({ where: { phone: "+15550000133" }, update: {}, create: { phone: "+15550000133", role: "worker", workerProfile: { create: { stripeAccountId: "acct_y" } } } });
    const trade = await prisma.trade.findFirstOrThrow({ where: { slug: "cleaning" } });
    const j = await prisma.job.create({ data: { clientId: c.id, tradeId: trade.id, title: "T", description: "1234567890", address: "x", lat: 0, lng: 0, urgency: "now", status: "completed" } });
    const q = await prisma.quote.create({ data: { jobId: j.id, workerId: w.id, amountCents: 5000 } });
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const b = await prisma.booking.create({ data: {
      jobId: j.id, quoteId: q.id, clientId: c.id, workerId: w.id,
      amountCents: 5000, platformFeeCents: 750, status: "released", releasedAt: oldDate,
    }});
    const tok = (await container.tokens.issuePair(c.id, "client")).accessToken;
    const res = await app.inject({
      method: "POST", url: `/bookings/${b.id}/tip`,
      headers: { authorization: `Bearer ${tok}` },
      payload: { amountCents: 500 },
    });
    expect(res.statusCode).toBe(409);
  });
});
```

- [ ] **Step 3: Implement**

Append to `bookingRoutes`:

```ts
import { TipSchema } from "@cleansmart/shared";
// ...
app.post("/bookings/:id/tip", { preHandler: [requireAuth, requireRole("client")] }, async (req, reply) => {
  const id = (req.params as any).id;
  const body = TipSchema.parse(req.body);
  const b = await prisma.booking.findUnique({
    where: { id },
    include: { worker: { include: { workerProfile: true } } },
  });
  if (!b) return reply.status(404).send({ error: { code: "not_found", message: "Booking not found" } });
  if (b.clientId !== req.userId) return reply.status(403).send({ error: { code: "forbidden", message: "Not your booking" } });
  if (b.status !== "released" || !b.releasedAt) {
    return reply.status(409).send({ error: { code: "invalid_state", message: "Tip allowed only after release" } });
  }
  if (Date.now() - b.releasedAt.getTime() > 24 * 60 * 60 * 1000) {
    return reply.status(409).send({ error: { code: "tip_window_closed", message: "Tip window has closed" } });
  }
  if (b.tipPaymentIntentId) return reply.status(409).send({ error: { code: "already_tipped", message: "Tip already submitted" } });
  if (!b.worker.workerProfile?.stripeAccountId) {
    return reply.status(409).send({ error: { code: "worker_not_onboarded", message: "Worker not onboarded" } });
  }

  const pi = await stripe.createTipCharge({
    amountCents: body.amountCents,
    destinationAccountId: b.worker.workerProfile.stripeAccountId,
    bookingId: b.id,
  });
  await prisma.booking.update({
    where: { id }, data: { tipPaymentIntentId: pi.id },
  });
  return { paymentIntentId: pi.id, clientSecret: pi.client_secret };
});
```

- [ ] **Step 4: Run, commit**

```bash
git add apps/api/src/ packages/shared/
git commit -m "feat(api): tipping endpoint within 24h release window"
```

---

### Task 3: Review schemas

**Files:**
- Create: `packages/shared/src/schemas/reviews.ts`
- Modify: `packages/shared/src/schemas/index.ts`

- [ ] **Step 1: Create schema**

```ts
import { z } from "zod";

export const CreateReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
  photoKeys: z.array(z.string().min(1)).max(8).default([]),
});
export type CreateReview = z.infer<typeof CreateReviewSchema>;

export const ReviewPhotoPresignSchema = z.object({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});
export type ReviewPhotoPresign = z.infer<typeof ReviewPhotoPresignSchema>;
```

Add `export * from "./reviews";` and run `pnpm --filter @cleansmart/shared build`.

- [ ] **Step 2: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): review schemas"
```

---

### Task 4: Review routes — POST /bookings/:id/review, GET /workers/:id/reviews, GET /workers/:id/portfolio

**Files:**
- Create: `apps/api/src/routes/reviews.ts`
- Create: `apps/api/src/routes/__tests__/reviews.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../app";
import { buildContainer } from "../../container";
import { getPrisma } from "@cleansmart/db";

const container = buildContainer();
const app = buildApp(container);
const prisma = getPrisma();

let clientToken: string, workerToken: string;
let clientId: string, workerId: string, bookingId: string;

beforeAll(async () => {
  await prisma.review.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.quote.deleteMany();
  await prisma.job.deleteMany();
  await prisma.user.deleteMany({ where: { phone: { in: ["+15550000140","+15550000141"] } } });
  const c = await prisma.user.create({ data: { phone: "+15550000140", role: "client", clientProfile: { create: {} } } });
  clientId = c.id;
  clientToken = (await container.tokens.issuePair(c.id, "client")).accessToken;
  const w = await prisma.user.create({ data: { phone: "+15550000141", role: "worker", workerProfile: { create: { stripeAccountId: "acct_r" } } } });
  workerId = w.id;
  workerToken = (await container.tokens.issuePair(w.id, "worker")).accessToken;
  const trade = await prisma.trade.findFirstOrThrow({ where: { slug: "cleaning" } });
  const j = await prisma.job.create({ data: { clientId: c.id, tradeId: trade.id, title: "T", description: "1234567890", address: "x", lat: 0, lng: 0, urgency: "now", status: "completed" } });
  const q = await prisma.quote.create({ data: { jobId: j.id, workerId: w.id, amountCents: 5000, status: "accepted" } });
  const b = await prisma.booking.create({ data: { jobId: j.id, quoteId: q.id, clientId: c.id, workerId: w.id, amountCents: 5000, platformFeeCents: 750, status: "released", releasedAt: new Date() } });
  bookingId = b.id;
});

afterAll(() => app.close());

describe("reviews", () => {
  it("client reviews worker (5 stars + photos)", async () => {
    const res = await app.inject({
      method: "POST", url: `/bookings/${bookingId}/review`,
      headers: { authorization: `Bearer ${clientToken}` },
      payload: { rating: 5, comment: "Great work", photoKeys: ["reviews/p1.jpg"] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().direction).toBe("client_to_worker");
  });

  it("worker reviews client", async () => {
    const res = await app.inject({
      method: "POST", url: `/bookings/${bookingId}/review`,
      headers: { authorization: `Bearer ${workerToken}` },
      payload: { rating: 4 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().direction).toBe("worker_to_client");
  });

  it("rejects duplicate review from same direction", async () => {
    const res = await app.inject({
      method: "POST", url: `/bookings/${bookingId}/review`,
      headers: { authorization: `Bearer ${clientToken}` },
      payload: { rating: 3 },
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects review on un-released booking", async () => {
    const j = await prisma.job.create({ data: { clientId, tradeId: (await prisma.trade.findFirstOrThrow({ where: { slug: "cleaning" } })).id, title: "T", description: "1234567890", address: "x", lat: 0, lng: 0, urgency: "now" } });
    const q = await prisma.quote.create({ data: { jobId: j.id, workerId, amountCents: 1000 } });
    const b = await prisma.booking.create({ data: { jobId: j.id, quoteId: q.id, clientId, workerId, amountCents: 1000, platformFeeCents: 150, status: "funded" } });
    const res = await app.inject({
      method: "POST", url: `/bookings/${b.id}/review`,
      headers: { authorization: `Bearer ${clientToken}` },
      payload: { rating: 5 },
    });
    expect(res.statusCode).toBe(409);
  });

  it("GET /workers/:id/reviews returns aggregated reviews + average", async () => {
    const res = await app.inject({ method: "GET", url: `/workers/${workerId}/reviews` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.average).toBe(5);
    expect(body.count).toBe(1);
    expect(body.items.length).toBe(1);
  });

  it("GET /workers/:id/portfolio returns photos from reviews", async () => {
    const res = await app.inject({ method: "GET", url: `/workers/${workerId}/portfolio` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.photos).toContain("reviews/p1.jpg");
  });
});
```

- [ ] **Step 2: Implement reviews.ts**

```ts
import type { FastifyInstance } from "fastify";
import { CreateReviewSchema, ReviewPhotoPresignSchema } from "@cleansmart/shared";
import { randomUUID } from "node:crypto";
import { requireAuth, requireRole } from "../middleware/auth";

export async function reviewRoutes(app: FastifyInstance) {
  const { prisma, storage } = app.container;

  app.post("/reviews/photo-url", { preHandler: [requireAuth, requireRole("client")] }, async (req) => {
    const body = ReviewPhotoPresignSchema.parse(req.body);
    const ext = body.contentType === "image/jpeg" ? "jpg" : body.contentType.split("/")[1];
    const key = `reviews/${req.userId}/${randomUUID()}.${ext}`;
    return storage.presignPut(key, body.contentType);
  });

  app.post("/bookings/:id/review", { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as any).id;
    const body = CreateReviewSchema.parse(req.body);
    const b = await prisma.booking.findUnique({ where: { id } });
    if (!b) return reply.status(404).send({ error: { code: "not_found", message: "Booking not found" } });
    if (b.status !== "released") return reply.status(409).send({ error: { code: "invalid_state", message: "Reviews allowed after release only" } });
    let direction: "client_to_worker" | "worker_to_client";
    let subjectId: string;
    if (b.clientId === req.userId) { direction = "client_to_worker"; subjectId = b.workerId; }
    else if (b.workerId === req.userId) { direction = "worker_to_client"; subjectId = b.clientId; }
    else return reply.status(403).send({ error: { code: "forbidden", message: "Not part of booking" } });

    if (direction === "worker_to_client" && body.photoKeys.length > 0) {
      return reply.status(400).send({ error: { code: "no_photos", message: "Workers cannot attach photos to client reviews" } });
    }

    try {
      const review = await prisma.review.create({
        data: {
          bookingId: id, authorId: req.userId!, subjectId,
          direction, rating: body.rating, comment: body.comment,
          photos: body.photoKeys,
        },
      });
      reply.status(201);
      return review;
    } catch (err) {
      // unique constraint violation
      return reply.status(409).send({ error: { code: "duplicate", message: "Review already submitted" } });
    }
  });

  app.get("/workers/:id/reviews", async (req) => {
    const id = (req.params as any).id;
    const items = await prisma.review.findMany({
      where: { subjectId: id, direction: "client_to_worker" },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const agg = await prisma.review.aggregate({
      where: { subjectId: id, direction: "client_to_worker" },
      _avg: { rating: true }, _count: true,
    });
    return { average: agg._avg.rating ?? 0, count: agg._count, items };
  });

  app.get("/workers/:id/portfolio", async (req) => {
    const id = (req.params as any).id;
    const reviews = await prisma.review.findMany({
      where: { subjectId: id, direction: "client_to_worker", photos: { isEmpty: false } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const photos = reviews.flatMap((r) => r.photos);
    return { photos: photos.slice(0, 100) };
  });
}
```

- [ ] **Step 3: Wire and run**

Add `import { reviewRoutes } from "./routes/reviews";` and `app.register(reviewRoutes);`.

Run: `pnpm --filter @cleansmart/api test`

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/
git commit -m "feat(api): two-way reviews and worker portfolio"
```

---

### Task 5: Review-prompt notifications on release

**Files:**
- Modify: `apps/api/src/routes/bookings.ts`

- [ ] **Step 1: Enqueue review prompts after release**

In the `/bookings/:id/release` handler and in `autoReleaseBooking`, after the status update:

```ts
const tokens = await prisma.expoPushToken.findMany({
  where: { userId: { in: [b.clientId, b.workerId] } },
});
if (tokens.length) {
  const pushQueue = makeQueue("push", env.REDIS_URL);
  await pushQueue.add("send", tokens.map((t) => ({
    token: t.token,
    title: "Leave a review",
    body: "Tap to rate your recent CleanSmart booking",
    data: { type: "review_prompt", bookingId: b.id },
  })));
}
```

(Add the same in `queue/escrow-auto-release.ts` — pass through dependencies.)

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/
git commit -m "feat(api): push review prompt on booking release"
```

---

## Done criteria

- Clients can tip within 24h post-release; tip is a separate PaymentIntent with no platform fee.
- Reviews are gated on `released`; 5-star photo review by client; non-photo review by worker.
- Worker reviews aggregate to `average` + `count`.
- Portfolio endpoint returns review photos.
- Push prompt fires on release.
- All tested; CI green.
