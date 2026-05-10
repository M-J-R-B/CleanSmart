# CleanSmart Disputes & Admin Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Either party can open a dispute that freezes booking funds; ops resolves manually via a Next.js admin web app.

**Architecture:** Disputes are records on bookings; opening one transitions booking → `disputed` and cancels the auto-release. Admin web is a small Next.js (App Router) app served by Vercel that calls the API with admin JWT. Admin login uses email + magic link via Twilio Email/SendGrid (or simple shared-secret OTP for MVP).

**Tech Stack:** Next.js 14 (App Router), Tailwind, shadcn/ui, the existing API.

**Depends on:** Plans 1-6 complete.

---

### Task 1: Schema — Dispute

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add Dispute model**

```prisma
enum DisputeStatus {
  open
  resolved
}

enum DisputeResolution {
  refund_client
  release_worker
  split
  other
}

model Dispute {
  id              String              @id @default(uuid()) @db.Uuid
  bookingId       String              @map("booking_id") @db.Uuid
  raisedById      String              @map("raised_by_id") @db.Uuid
  reason          String
  evidence        String[]            @default([])
  status          DisputeStatus       @default(open)
  resolution      DisputeResolution?
  resolutionNotes String?             @map("resolution_notes")
  resolvedById    String?             @map("resolved_by_id") @db.Uuid
  resolvedAt      DateTime?           @map("resolved_at")
  createdAt       DateTime            @default(now()) @map("created_at")

  booking    Booking @relation(fields: [bookingId], references: [id])
  raisedBy   User    @relation("raisedDisputes", fields: [raisedById], references: [id])
  resolvedBy User?   @relation("resolvedDisputes", fields: [resolvedById], references: [id])

  @@index([bookingId])
  @@index([status])
  @@map("disputes")
}
```

- [ ] **Step 2: Back-relations**

In `User`:
```prisma
raisedDisputes   Dispute[] @relation("raisedDisputes")
resolvedDisputes Dispute[] @relation("resolvedDisputes")
```

In `Booking`:
```prisma
disputes Dispute[]
```

- [ ] **Step 3: Migrate**

Run: `pnpm --filter @cleansmart/db prisma:migrate:dev --name disputes`

- [ ] **Step 4: Commit**

```bash
git add packages/db/
git commit -m "feat(db): add Dispute model"
```

---

### Task 2: Dispute schemas

**Files:**
- Create: `packages/shared/src/schemas/disputes.ts`
- Modify: `packages/shared/src/schemas/index.ts`

- [ ] **Step 1: Create schemas**

```ts
import { z } from "zod";

export const OpenDisputeSchema = z.object({
  reason: z.string().min(10).max(2000),
  evidence: z.array(z.string()).max(10).default([]),
});
export type OpenDispute = z.infer<typeof OpenDisputeSchema>;

export const ResolveDisputeSchema = z.object({
  resolution: z.enum(["refund_client", "release_worker", "split", "other"]),
  notes: z.string().min(1).max(2000),
  splitClientCents: z.number().int().nonnegative().optional(),
  splitWorkerCents: z.number().int().nonnegative().optional(),
});
export type ResolveDispute = z.infer<typeof ResolveDisputeSchema>;
```

Add `export * from "./disputes";` and build.

- [ ] **Step 2: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): dispute schemas"
```

---

### Task 3: Dispute open/list routes — POST /bookings/:id/dispute, GET /me/disputes

**Files:**
- Create: `apps/api/src/routes/disputes.ts`
- Create: `apps/api/src/routes/__tests__/disputes.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildApp } from "../../app";
import { buildContainer } from "../../container";
import { getPrisma } from "@cleansmart/db";

const container = buildContainer();
const app = buildApp(container);
const prisma = getPrisma();

let clientToken: string, workerToken: string, bookingId: string;

beforeAll(async () => {
  await prisma.dispute.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.quote.deleteMany();
  await prisma.job.deleteMany();
  await prisma.user.deleteMany({ where: { phone: { in: ["+15550000150","+15550000151"] } } });
  const c = await prisma.user.create({ data: { phone: "+15550000150", role: "client", clientProfile: { create: {} } } });
  clientToken = (await container.tokens.issuePair(c.id, "client")).accessToken;
  const w = await prisma.user.create({ data: { phone: "+15550000151", role: "worker", workerProfile: { create: { stripeAccountId: "acct_d" } } } });
  workerToken = (await container.tokens.issuePair(w.id, "worker")).accessToken;
  const trade = await prisma.trade.findFirstOrThrow({ where: { slug: "cleaning" } });
  const j = await prisma.job.create({ data: { clientId: c.id, tradeId: trade.id, title: "T", description: "1234567890", address: "x", lat: 0, lng: 0, urgency: "now", status: "in_progress" } });
  const q = await prisma.quote.create({ data: { jobId: j.id, workerId: w.id, amountCents: 10000, status: "accepted" } });
  const b = await prisma.booking.create({ data: { jobId: j.id, quoteId: q.id, clientId: c.id, workerId: w.id, amountCents: 10000, platformFeeCents: 1500, status: "started", startedAt: new Date(), escrowPaymentIntentId: "pi_d" } });
  bookingId = b.id;
});

afterAll(() => app.close());

describe("disputes", () => {
  it("client opens dispute on started booking", async () => {
    const res = await app.inject({
      method: "POST", url: `/bookings/${bookingId}/dispute`,
      headers: { authorization: `Bearer ${clientToken}` },
      payload: { reason: "Worker did not show up at agreed time", evidence: [] },
    });
    expect(res.statusCode).toBe(201);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(b.status).toBe("disputed");
  });

  it("rejects second dispute on same booking", async () => {
    const res = await app.inject({
      method: "POST", url: `/bookings/${bookingId}/dispute`,
      headers: { authorization: `Bearer ${workerToken}` },
      payload: { reason: "Different complaint at length here." },
    });
    expect(res.statusCode).toBe(409);
  });

  it("GET /me/disputes lists disputes user is a party to", async () => {
    const res = await app.inject({ method: "GET", url: "/me/disputes", headers: { authorization: `Bearer ${clientToken}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBe(1);
  });
});
```

- [ ] **Step 2: Implement**

```ts
import type { FastifyInstance } from "fastify";
import { OpenDisputeSchema } from "@cleansmart/shared";
import { requireAuth } from "../middleware/auth";

export async function disputeRoutes(app: FastifyInstance) {
  const { prisma } = app.container;

  app.post("/bookings/:id/dispute", { preHandler: requireAuth }, async (req, reply) => {
    const id = (req.params as any).id;
    const body = OpenDisputeSchema.parse(req.body);
    const b = await prisma.booking.findUnique({ where: { id }, include: { disputes: true } });
    if (!b) return reply.status(404).send({ error: { code: "not_found", message: "Booking not found" } });
    if (b.clientId !== req.userId && b.workerId !== req.userId) {
      return reply.status(403).send({ error: { code: "forbidden", message: "Not part of booking" } });
    }
    if (b.disputes.some((d) => d.status === "open")) {
      return reply.status(409).send({ error: { code: "duplicate", message: "Dispute already open" } });
    }
    if (!["funded", "started", "completed"].includes(b.status)) {
      return reply.status(409).send({ error: { code: "invalid_state", message: "Cannot dispute in current state" } });
    }

    const [dispute] = await prisma.$transaction([
      prisma.dispute.create({
        data: { bookingId: id, raisedById: req.userId!, reason: body.reason, evidence: body.evidence },
      }),
      prisma.booking.update({ where: { id }, data: { status: "disputed" } }),
      prisma.job.update({ where: { id: b.jobId }, data: { status: "disputed" } }),
    ]);
    reply.status(201);
    return dispute;
  });

  app.get("/me/disputes", { preHandler: requireAuth }, async (req) => {
    return prisma.dispute.findMany({
      where: { booking: { OR: [{ clientId: req.userId }, { workerId: req.userId }] } },
      include: { booking: { include: { job: true } } },
      orderBy: { createdAt: "desc" },
    });
  });
}
```

- [ ] **Step 3: Wire, run, commit**

Add registration in app.ts.
Run: `pnpm --filter @cleansmart/api test`

```bash
git add apps/api/src/
git commit -m "feat(api): open and list disputes"
```

---

### Task 4: Admin resolution route — POST /admin/disputes/:id/resolve

**Files:**
- Modify: `apps/api/src/routes/disputes.ts`
- Modify: `apps/api/src/routes/__tests__/disputes.test.ts`

- [ ] **Step 1: Implement**

Append:

```ts
import { ResolveDisputeSchema } from "@cleansmart/shared";
// ...

app.get("/admin/disputes", { preHandler: [requireAuth, requireRole("admin")] }, async (req) => {
  return prisma.dispute.findMany({
    where: { status: "open" },
    include: { booking: { include: { client: true, worker: true, job: true } } },
    orderBy: { createdAt: "asc" },
  });
});

app.post("/admin/disputes/:id/resolve", { preHandler: [requireAuth, requireRole("admin")] }, async (req, reply) => {
  const id = (req.params as any).id;
  const body = ResolveDisputeSchema.parse(req.body);
  const d = await prisma.dispute.findUnique({
    where: { id },
    include: { booking: { include: { worker: { include: { workerProfile: true } } } } },
  });
  if (!d) return reply.status(404).send({ error: { code: "not_found", message: "Dispute not found" } });
  if (d.status !== "open") return reply.status(409).send({ error: { code: "already_resolved", message: "Already resolved" } });
  const b = d.booking;
  if (!b.escrowPaymentIntentId) return reply.status(409).send({ error: { code: "no_pi", message: "No PaymentIntent on booking" } });

  switch (body.resolution) {
    case "refund_client":
      await app.container.stripe.refundPaymentIntent(b.escrowPaymentIntentId);
      await prisma.booking.update({ where: { id: b.id }, data: { status: "refunded" } });
      break;
    case "release_worker":
      await app.container.stripe.capturePaymentIntent(b.escrowPaymentIntentId);
      await prisma.booking.update({ where: { id: b.id }, data: { status: "released", releasedAt: new Date() } });
      break;
    case "split":
    case "other":
      // For MVP: capture full amount and let ops manually adjust via Stripe dashboard, recording notes.
      await app.container.stripe.capturePaymentIntent(b.escrowPaymentIntentId);
      await prisma.booking.update({ where: { id: b.id }, data: { status: "released", releasedAt: new Date() } });
      break;
  }

  await prisma.dispute.update({
    where: { id },
    data: {
      status: "resolved",
      resolution: body.resolution,
      resolutionNotes: body.notes,
      resolvedById: req.userId!,
      resolvedAt: new Date(),
    },
  });
  return prisma.dispute.findUniqueOrThrow({ where: { id } });
});
```

- [ ] **Step 2: Test**

Append:

```ts
it("admin resolves dispute as refund_client", async () => {
  container.stripe.refundPaymentIntent = vi.fn(async () => ({} as any)) as any;
  const admin = await prisma.user.create({ data: { phone: "+15550000152", role: "admin" } });
  const adminTok = (await container.tokens.issuePair(admin.id, "admin")).accessToken;
  const dispute = await prisma.dispute.findFirstOrThrow({ where: { status: "open" } });
  const res = await app.inject({
    method: "POST", url: `/admin/disputes/${dispute.id}/resolve`,
    headers: { authorization: `Bearer ${adminTok}` },
    payload: { resolution: "refund_client", notes: "Worker no-show confirmed via SMS log." },
  });
  expect(res.statusCode).toBe(200);
  const after = await prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id } });
  expect(after.status).toBe("resolved");
});
```

- [ ] **Step 3: Run, commit**

```bash
git add apps/api/src/
git commit -m "feat(api): admin dispute resolution endpoint"
```

---

### Task 5: Admin user creation script (out-of-band)

**Files:**
- Create: `apps/api/scripts/create-admin.ts`

- [ ] **Step 1: Create script**

```ts
import "dotenv/config";
import { getPrisma } from "@cleansmart/db";

async function main() {
  const phone = process.argv[2];
  const name = process.argv[3] ?? "Admin";
  if (!phone) {
    console.error("Usage: tsx scripts/create-admin.ts +15555550000 Name");
    process.exit(1);
  }
  const prisma = getPrisma();
  const u = await prisma.user.upsert({
    where: { phone },
    update: { role: "admin", name },
    create: { phone, role: "admin", name },
  });
  console.log("Admin user:", u);
}
main();
```

Add script to api package.json:
```json
"create:admin": "tsx scripts/create-admin.ts"
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/
git commit -m "chore(api): admin user creation script"
```

---

### Task 6: Scaffold Next.js admin web app

**Files:**
- Create: `apps/admin-web/package.json`
- Create: `apps/admin-web/next.config.mjs`
- Create: `apps/admin-web/tsconfig.json`
- Create: `apps/admin-web/tailwind.config.ts`
- Create: `apps/admin-web/postcss.config.mjs`
- Create: `apps/admin-web/src/app/layout.tsx`
- Create: `apps/admin-web/src/app/page.tsx`
- Create: `apps/admin-web/src/app/globals.css`
- Create: `apps/admin-web/.env.example`

- [ ] **Step 1: package.json**

```json
{
  "name": "@cleansmart/admin-web",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -p 3001",
    "typecheck": "tsc --noEmit",
    "lint": "next lint"
  },
  "dependencies": {
    "@cleansmart/shared": "workspace:*",
    "next": "14.2.3",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "tailwindcss": "3.4.3",
    "autoprefixer": "10.4.19",
    "postcss": "8.4.38"
  },
  "devDependencies": {
    "typescript": "5.4.5",
    "@types/node": "20.12.7",
    "@types/react": "18.3.1",
    "@types/react-dom": "18.3.0"
  }
}
```

- [ ] **Step 2: next.config.mjs**

```js
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@cleansmart/shared"],
};
export default nextConfig;
```

- [ ] **Step 3: tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "outDir": "dist",
    "rootDir": "src",
    "noEmit": true,
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["src/**/*", "next-env.d.ts"]
}
```

- [ ] **Step 4: tailwind config + postcss**

`tailwind.config.ts`:
```ts
import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};
export default config;
```

`postcss.config.mjs`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 5: globals.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 6: layout + page**

`src/app/layout.tsx`:
```tsx
import "./globals.css";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50">{children}</body>
    </html>
  );
}
```

`src/app/page.tsx`:
```tsx
export default function Home() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">CleanSmart Admin</h1>
      <p className="mt-2 text-gray-600">Sign in to manage disputes, users, and bookings.</p>
    </main>
  );
}
```

- [ ] **Step 7: .env.example**

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
ADMIN_SHARED_SECRET=replace-with-strong-secret
```

- [ ] **Step 8: Install + run**

Run: `pnpm install`
Run: `cp apps/admin-web/.env.example apps/admin-web/.env.local`
Run: `pnpm --filter @cleansmart/admin-web dev`
Visit `http://localhost:3001` — should render the heading.

- [ ] **Step 9: Commit**

```bash
git add apps/admin-web/ pnpm-lock.yaml
git commit -m "feat(admin-web): scaffold next.js admin app"
```

---

### Task 7: Admin login (phone OTP) — reuse API auth

**Files:**
- Create: `apps/admin-web/src/lib/api.ts`
- Create: `apps/admin-web/src/app/login/page.tsx`
- Create: `apps/admin-web/src/components/AuthShell.tsx`

- [ ] **Step 1: api.ts client**

```ts
const BASE = process.env.NEXT_PUBLIC_API_BASE_URL!;

export interface Session { accessToken: string; refreshToken: string; user: { id: string; role: string } }

export async function requestOtp(phone: string) {
  const res = await fetch(`${BASE}/auth/otp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone }) });
  if (!res.ok) throw new Error(`OTP request failed: ${res.status}`);
}

export async function verifyOtp(phone: string, code: string): Promise<Session> {
  const res = await fetch(`${BASE}/auth/verify`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, code, role: "client" }),
  });
  if (!res.ok) throw new Error("Verify failed");
  return res.json();
}

export async function api(path: string, init: RequestInit = {}, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json();
}
```

NOTE: admins must already exist in DB (via the `create:admin` script) and must verify via the same `/auth/verify` flow. The frontend just needs to gate routes by checking `user.role === "admin"`.

Update `verifyOtp` to allow null role for existing users. Adjust API: in `routes/auth.ts` POST /verify, after `prisma.user.upsert`, if the user already exists with role `admin`, do not overwrite. Modify the upsert:

```ts
const existing = await prisma.user.findUnique({ where: { phone: body.phone } });
const user = existing
  ? await prisma.user.update({ where: { id: existing.id }, data: { name: body.name ?? undefined } })
  : await prisma.user.create({ data: { phone: body.phone, role: body.role, name: body.name ?? null } });
```

(Update API + tests to ensure `role` from request only applies on creation.)

- [ ] **Step 2: login page**

```tsx
"use client";
import { useState } from "react";
import { requestOtp, verifyOtp } from "@/lib/api";

export default function Login() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setError(null);
    try { await requestOtp(phone); setStage("code"); } catch (e: any) { setError(e.message); }
  }
  async function verify() {
    setError(null);
    try {
      const session = await verifyOtp(phone, code);
      if (session.user.role !== "admin") { setError("Not an admin account"); return; }
      localStorage.setItem("cs_session", JSON.stringify(session));
      window.location.href = "/disputes";
    } catch (e: any) { setError(e.message); }
  }

  return (
    <main className="max-w-sm mx-auto p-8">
      <h1 className="text-xl font-semibold mb-4">Admin sign-in</h1>
      {error && <div className="text-red-600 mb-2">{error}</div>}
      {stage === "phone" ? (
        <>
          <input className="w-full border p-2 rounded" placeholder="+15551234567"
                 value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button className="mt-3 px-4 py-2 bg-blue-600 text-white rounded" onClick={send}>Send code</button>
        </>
      ) : (
        <>
          <input className="w-full border p-2 rounded" placeholder="123456"
                 value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="mt-3 px-4 py-2 bg-blue-600 text-white rounded" onClick={verify}>Verify</button>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/admin-web/ apps/api/
git commit -m "feat(admin-web): admin login via phone OTP"
```

---

### Task 8: Admin disputes list + resolution UI

**Files:**
- Create: `apps/admin-web/src/app/disputes/page.tsx`
- Create: `apps/admin-web/src/app/disputes/[id]/page.tsx`

- [ ] **Step 1: List page**

```tsx
"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Link from "next/link";

interface Dispute { id: string; reason: string; createdAt: string; booking: { id: string; amountCents: number; client: { name: string | null }; worker: { name: string | null } } }

export default function DisputesPage() {
  const [items, setItems] = useState<Dispute[]>([]);
  useEffect(() => {
    const sess = JSON.parse(localStorage.getItem("cs_session") ?? "null");
    if (!sess) { window.location.href = "/login"; return; }
    api("/admin/disputes", {}, sess.accessToken).then(setItems);
  }, []);
  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold mb-4">Open disputes</h1>
      <table className="w-full text-sm">
        <thead><tr className="text-left"><th>When</th><th>Client</th><th>Worker</th><th>Amount</th><th>Reason</th><th></th></tr></thead>
        <tbody>
          {items.map((d) => (
            <tr key={d.id} className="border-t">
              <td>{new Date(d.createdAt).toLocaleString()}</td>
              <td>{d.booking.client.name ?? "—"}</td>
              <td>{d.booking.worker.name ?? "—"}</td>
              <td>${(d.booking.amountCents / 100).toFixed(2)}</td>
              <td className="truncate max-w-xs">{d.reason}</td>
              <td><Link className="text-blue-600" href={`/disputes/${d.id}`}>Resolve</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 2: Detail / resolve page**

```tsx
"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function DisputeDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [resolution, setResolution] = useState("refund_client");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    const sess = JSON.parse(localStorage.getItem("cs_session") ?? "null");
    api("/admin/disputes", {}, sess.accessToken).then((items) => setData(items.find((d: any) => d.id === id)));
  }, [id]);

  async function resolve() {
    const sess = JSON.parse(localStorage.getItem("cs_session") ?? "null");
    await api(`/admin/disputes/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ resolution, notes }),
    }, sess.accessToken);
    router.push("/disputes");
  }

  if (!data) return <main className="p-8">Loading…</main>;
  return (
    <main className="p-8 max-w-2xl">
      <h1 className="text-xl font-semibold mb-4">Dispute</h1>
      <p className="mb-2"><strong>Reason:</strong> {data.reason}</p>
      <p className="mb-2"><strong>Booking:</strong> ${(data.booking.amountCents / 100).toFixed(2)}</p>
      <p className="mb-4"><strong>Client:</strong> {data.booking.client.name} • <strong>Worker:</strong> {data.booking.worker.name}</p>
      <select className="border p-2 rounded mb-2" value={resolution} onChange={(e) => setResolution(e.target.value)}>
        <option value="refund_client">Refund client</option>
        <option value="release_worker">Release worker</option>
        <option value="split">Split</option>
        <option value="other">Other</option>
      </select>
      <textarea className="w-full border p-2 rounded mb-2" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Resolution notes" />
      <button className="px-4 py-2 bg-blue-600 text-white rounded" onClick={resolve}>Resolve</button>
    </main>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/admin-web/
git commit -m "feat(admin-web): disputes list + resolution UI"
```

---

### Task 9: Admin users + bookings views (read-only)

**Files:**
- Create: `apps/admin-web/src/app/users/page.tsx`
- Create: `apps/admin-web/src/app/bookings/page.tsx`
- Modify: `apps/api/src/routes/disputes.ts` (add admin endpoints)

- [ ] **Step 1: Add admin list endpoints**

Append to disputes.ts (or create `routes/admin.ts`):

```ts
app.get("/admin/users", { preHandler: [requireAuth, requireRole("admin")] }, async () => {
  return prisma.user.findMany({
    take: 200, orderBy: { createdAt: "desc" },
    include: { workerProfile: true, clientProfile: true },
  });
});

app.get("/admin/bookings", { preHandler: [requireAuth, requireRole("admin")] }, async () => {
  return prisma.booking.findMany({
    take: 200, orderBy: { createdAt: "desc" },
    include: { client: true, worker: true, job: true },
  });
});
```

- [ ] **Step 2: Build the two pages**

Use the same pattern as disputes — fetch on mount, render a table.

- [ ] **Step 3: Commit**

```bash
git add apps/admin-web/ apps/api/
git commit -m "feat(admin-web,api): read-only users + bookings admin views"
```

---

## Done criteria

- Either party can open one dispute per booking; opening freezes the booking.
- Admin can see open disputes and resolve with refund/release/split/other (capture or refund the PI).
- Admin web app has phone-OTP login that requires `role === admin`.
- Admin can browse users, bookings, disputes via the web UI.
- All flows tested at the API layer; CI green. Admin web has typecheck + lint passing.
