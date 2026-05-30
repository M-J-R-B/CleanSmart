# CleanSmart

Two-sided marketplace connecting clients to blue-collar service workers.

## Quickstart

Prereqs: Node 20, pnpm 9, Docker Desktop.

```bash
pnpm install
docker compose up -d
cp packages/db/.env.example packages/db/.env
cp apps/api/.env.example apps/api/.env
pnpm --filter @cleansmart/db prisma:migrate:dev
pnpm dev:api
curl http://localhost:3000/health
```

## Workspace

- `apps/api` — Fastify backend (TypeScript)
- `packages/db` — Prisma schema + client
- `packages/shared` — shared types + env parser

See `docs/superpowers/specs/` for the design spec and `docs/superpowers/plans/` for implementation plans.
