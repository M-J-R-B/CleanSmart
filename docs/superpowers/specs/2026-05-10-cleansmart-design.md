# CleanSmart — Design Spec

**Date:** 2026-05-10
**Status:** Approved for implementation planning
**Author:** Brainstorm session (mbaselisco@gmail.com + Claude)

## 1. Summary

CleanSmart is a two-sided mobile marketplace connecting clients to blue-collar service workers across all trades (cleaning, handyman, plumbing, electrical, lawn care, etc.) for quick gigs and scheduled jobs. Clients post jobs; workers submit quotes; the client picks one; CleanSmart holds payment in escrow until the job is completed and confirmed.

The MVP launches in a single metro area, prioritizes the client experience, and uses light worker verification to minimize onboarding friction.

## 2. Decisions Locked During Brainstorming

| Dimension | Choice |
|---|---|
| Primary user | Clients |
| Trade scope | All blue-collar (horizontal) |
| Matching mechanism | Quote bidding (Thumbtack-style) |
| Geography | Single metro area |
| Payments | Platform-held escrow via Stripe Connect |
| Platform | Native iOS + Android (React Native) + minimal admin web |
| Worker verification | Light-touch (phone OTP + selfie ID) |
| Job urgency | Now / This week / Scheduled (flag on post) |
| Reviews | Two-way + worker portfolio photos |
| Architecture | Monolith API + Postgres + Redis |
| Tipping | In MVP, 100% to worker, no platform fee |

## 3. High-Level Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Client App     │    │  Worker App     │    │  Marketing/Admin│
│  (React Native) │    │  (React Native) │    │  Web (Next.js)  │
└────────┬────────┘    └────────┬────────┘    └────────┬────────┘
         │                      │                      │
         └──────────────────────┼──────────────────────┘
                                │ REST + WebSocket
                  ┌─────────────▼──────────────┐
                  │   CleanSmart API Monolith  │
                  │  (Node.js + Fastify + TS)  │
                  └──────┬─────────────┬───────┘
                         │             │
              ┌──────────▼───┐   ┌─────▼──────┐
              │  PostgreSQL   │   │   Redis    │
              │ (+ PostGIS)   │   │ (BullMQ +  │
              └───────────────┘   │  pub/sub)  │
                                  └─────┬──────┘
                                        │
                          ┌─────────────▼────────────┐
                          │  Background Workers      │
                          │ (notifications, payouts, │
                          │  escrow auto-release)    │
                          └──────────────────────────┘

External services:
  - Stripe Connect (Express accounts) — escrow, KYC, payouts
  - FCM + APNs (via Expo) — push notifications
  - S3 / Cloudflare R2 — photos, ID documents
  - Twilio — SMS OTP
  - Persona (or Stripe Identity) — selfie + ID verification
```

**Two mobile apps, one backend.** Client and worker apps are separate React Native bundles sharing a `packages/shared` workspace (types, API client, design tokens). One Fastify API serves both, plus a small Next.js app for marketing + ops admin.

**Why two RN apps instead of one with role-switching:** different navigation, different permissions, smaller per-user bundles, and either app can iterate independently.

## 4. Data Model

Eleven primary tables. Field lists are not exhaustive — only the load-bearing columns.

```
users                  ─ id, email, phone, role(client|worker|admin), name, avatar_url, created_at

worker_profiles        ─ user_id, bio, trades[] (FK trades),
                         service_radius_km, home_lat/lng,
                         stripe_account_id, verified_at

client_profiles        ─ user_id, default_address, saved_payment_method_id

trades (lookup)        ─ id, slug, name, icon, requires_license

jobs                   ─ id, client_id, trade_id, title, description, photos[],
                         address, lat/lng,
                         urgency(now|this_week|scheduled), scheduled_at,
                         budget_min_cents, budget_max_cents,
                         status(open|quoted|accepted|in_progress|completed|cancelled|disputed),
                         accepted_quote_id, created_at

quotes                 ─ id, job_id, worker_id, amount_cents, message,
                         eta_minutes (nullable; for "now" urgency),
                         status(pending|accepted|rejected|withdrawn), created_at

bookings               ─ id, job_id, quote_id, client_id, worker_id,
                         escrow_payment_intent_id, platform_fee_cents,
                         tip_cents, tip_payment_intent_id,
                         status(pending_payment|funded|started|completed|released|refunded|disputed),
                         started_at, completed_at, released_at

reviews                ─ id, booking_id, author_id, subject_id,
                         rating(1-5), comment, photos[] (worker→portfolio),
                         direction(client_to_worker|worker_to_client), created_at

messages               ─ id, job_id, sender_id, body, attachments[], created_at

notifications          ─ id, user_id, type, payload (JSONB), read_at, created_at

disputes               ─ id, booking_id, raised_by, reason, evidence[],
                         status(open|resolved), resolution_notes, resolved_by, created_at
```

**Key relationships:**
- A `job` has many `quotes`. One quote gets accepted, which creates a `booking`.
- A `booking` is the payment + service-delivery record. All escrow state lives here.
- `messages` are keyed to `job` (the thread survives the quote → booking transition).
- `reviews` are two-way; the worker's review photos populate their portfolio.

**Why separate `jobs` from `bookings`:** jobs can die (no quotes, client cancels) without ever entering the payment lifecycle. Keeps escrow logic narrowly scoped to bookings.

## 5. Job & Escrow Lifecycle

```
1. POST JOB (client)
   client fills form → photos uploaded to S3 → job.status = "open"
   → background worker fans out push notifications to nearby matching workers

2. QUOTES (workers)
   workers see open-jobs feed (filtered by trade + radius + urgency)
   submit quote (amount + message + ETA if "now") → quote.status = "pending"
   client gets push: "N quotes received"

3. ACCEPT QUOTE (client)
   client picks a quote → API:
     a. creates booking (status=pending_payment)
     b. creates Stripe PaymentIntent with application_fee_amount + transfer_group=booking_id
     c. returns client_secret to app
   client confirms payment in app → Stripe webhook payment_intent.succeeded
     → booking.status = "funded", job.status = "accepted"
     → other quotes → "rejected"

4. JOB EXECUTION
   worker taps "Start" on arrival → booking.status = "started"
   worker taps "Complete" → booking.status = "completed"
   client gets push: "Confirm completion"

5. ESCROW RELEASE
   client confirms → Stripe Transfer (amount - platform_fee) to worker's connected account
     → booking.status = "released"
   if client doesn't confirm in 48h → BullMQ delayed job auto-releases
   either party can open dispute before release → booking.status = "disputed", funds frozen

6. TIPPING (post-completion)
   on release prompt, client can add tip ($5 / $10 / 15% / 20% / custom)
   tip processed as separate Stripe charge → 100% transferred to worker, no platform fee
   tipping window closes 24h after release

7. REVIEWS
   on release: both parties prompted (1-5 stars + comment + worker photos)
```

**Cancellation rules:**
- Before funding: free cancellation by either party.
- After funding, before "started": full refund to client, no penalty.
- After "started": cancellation goes through dispute path.

**Platform fee:** taken at PaymentIntent creation via Stripe `application_fee_amount`. Workers see net payout cleanly. Fee percentage TBD by business (placeholder in code; configurable).

## 6. Matching, Search, and Notifications

**Worker job feed:**

```
GET /api/jobs/feed
  filters: trade IN worker.trades
           ST_DWithin(job.location::geography, worker.home::geography,
                      worker.service_radius_km * 1000)
           job.status = "open"
           urgency in worker.urgency_preferences
  sort:    urgency DESC (now > this_week > scheduled), created_at DESC
  paging:  cursor-based, 20 per page
```

Geo filtering uses **PostGIS** (`ST_DWithin` on `geography(Point, 4326)`) with GIST indexes.

**Post-job flow (client):**
1. Pick trade (icon grid, ~15 trades seeded)
2. Describe (title + description + optional photos to S3 via signed URL)
3. Set urgency (Now / This week / Pick a date)
4. Confirm address (default from profile, or pick on map)
5. Optional budget range
6. Post → fan-out begins

**Notification fan-out (BullMQ worker):**

```
on job.created:
  find workers where trade matches AND ST_DWithin(home, job.location, radius)
  cap at 50 nearest workers
  enqueue push job per worker (Expo Notifications → FCM/APNs)
  payload: deep-link to /jobs/:id in worker app
  also write notifications row for in-app inbox
```

**Notification types:**
- Worker: new job in area / quote accepted / quote rejected / new message / payout released / tip received
- Client: new quote received / worker started / worker completed / dispute opened / review reminder / tip prompt

**Messaging:** Socket.io connection per active session, messages persist to DB, offline users get push notification with preview. WebSocket sessions also receive live quote updates.

**Search (post-MVP):** Postgres full-text search on worker portfolios initially; move to Algolia/Meilisearch only if scale demands it.

## 7. Tech Stack

| Layer | Choice |
|---|---|
| Mobile | React Native + Expo (managed) |
| Monorepo | pnpm workspaces (`apps/client`, `apps/worker`, `apps/admin-web`, `apps/api`, `packages/shared`) |
| API | Node.js + Fastify + TypeScript + zod |
| ORM | Prisma |
| Database | PostgreSQL 16 + PostGIS extension |
| Cache / Queue | Redis + BullMQ |
| Realtime | Socket.io |
| Auth | JWT (access + refresh) + Twilio SMS OTP |
| Payments | Stripe Connect (Express accounts) |
| Storage | S3 or Cloudflare R2 + signed URLs |
| Push | Expo Notifications → FCM + APNs |
| ID Verification | Persona (or Stripe Identity) |
| Hosting | Fly.io or Railway (API + workers), Vercel (admin web), managed Postgres |
| Observability | Sentry + Axiom/Logtail |
| CI | GitHub Actions |

## 8. Testing Strategy

- **Unit (Vitest):** pure logic — pricing, fee calc, geo filters, state-machine transitions. Coverage target 80% on backend business logic.
- **Integration (Vitest + Testcontainers Postgres):** API routes against a real Postgres + PostGIS DB.
- **E2E mobile (Detox or Maestro):** critical happy-path flows only — post-job, accept-quote, payment, release.
- **Stripe** uses test mode + recorded webhook fixtures; tests never hit live mode.

## 9. Error Handling Principles

- All API errors return `{ error: { code, message, details? } }` with stable codes for client error mapping.
- Idempotency keys on payment-creating endpoints (clients send UUID; required by Stripe and internally).
- Webhook handlers are idempotent — Stripe retries are normal and expected.
- Background jobs (BullMQ) have automatic retries with exponential backoff; failures land in a dead-letter queue for ops review.
- Booking + PaymentIntent creation runs in a DB transaction with compensating cleanup if the Stripe call fails.

## 10. MVP Scope

### In scope (v1.0)
- Client signup/login (phone OTP)
- Worker signup/login + light verification (phone OTP + selfie ID via Persona)
- Worker profile (trades, bio, service radius, home location)
- Trade catalog (~15 seeded trades)
- Post a job (trade, description, photos, urgency, address, budget range)
- Worker job feed (filtered by trade + radius + urgency)
- Submit / withdraw quotes
- Accept quote → Stripe escrow payment
- Booking lifecycle (start → complete → release)
- 48h auto-release
- Tipping (post-completion, 100% to worker, no platform fee)
- Two-way reviews + worker portfolio
- In-app messaging (per-job thread)
- Push notifications (FCM/APNs via Expo)
- Disputes (raise + freeze funds; admin resolves manually)
- Admin web (basic): users, jobs, bookings, disputes, manual refunds
- Single metro area (configurable bounding box)

### Out of scope (deferred to v1.1+)
- License/insurance verification for skilled trades (TOS self-attestation only for MVP)
- Background checks (Checkr integration)
- Worker subscriptions / featured listings
- Recurring bookings (weekly cleanings)
- Referral / promo codes
- Multi-metro expansion
- Native browse-and-book flow (clients can only post jobs and review quotes)
- Calendar integration / availability schedules
- Automated dispute arbitration (manual only for MVP)
- Web client app (mobile only for end users)
- Multi-language / i18n

## 11. Success Criteria

- 50 verified workers across ≥10 trades in target metro
- 100 jobs posted in first month with ≥1 quote each
- ≥60% of accepted bookings reach successful release
- <5% dispute rate
- Median time from "post job" → "first quote" under 30 minutes for Now / This week urgency

## 12. Known Risks

- ⚠️ **Light verification + skilled trades** — potential liability if an unlicensed electrician injures a client. Mitigated by TOS self-attestation; license verification will be added before scaling beyond MVP metro.
- ⚠️ **Two-sided liquidity** — new metros are hard to bootstrap. Plan: hand-recruit first 30-50 workers before public launch.
- ⚠️ **Stripe Connect KYC rejections** — some workers will fail KYC. Need clear UX explaining the rejection and remediation path.
- ⚠️ **Disputes scale linearly with volume** — manual resolution doesn't scale. Acceptable for MVP; revisit before second metro.
