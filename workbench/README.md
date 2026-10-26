# Wisner Workbench

Internal planning, scheduling, estimating, time-tracking and client-records app for Wisner Engineering, LLC (Astoria, Oregon). Two users: Brian (owner) and Erika (staff).

- **Docs:** [User guide](docs/USER_GUIDE.md) · [Deployment, backups, Google setup](docs/DEPLOYMENT.md) · [Requirements checklist](docs/REQUIREMENTS.md) · [Testing report](docs/TESTING.md) · [Research](docs/RESEARCH.md)
- **Screenshots:** `docs/screenshots/desktop` and `docs/screenshots/iphone` (taken with labeled demo data)

## Stack
Next.js 16 (App Router) · TypeScript · PostgreSQL + Drizzle ORM · Tailwind CSS · Recharts · googleapis · Vitest · Playwright.

## Local development
```
cp .env.example .env        # set DATABASE_URL etc.
npm install
npm run migrate
npm run dev                 # http://localhost:3000 → /setup on first run
```
Set `APP_ENV=demo` locally to enable *Settings → Data → Load sample data* (records are prefixed "DEMO –").

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | develop / build / serve |
| `npm run migrate` | apply SQL migrations in `drizzle/` |
| `npm run db:generate` | generate a migration after editing `src/lib/db/schema.ts` |
| `npm run test` | unit tests (engines) |
| `npm run test:e2e` | Playwright workflows (wipes the connected database first) |
| `npm run test:all` | typecheck + lint + unit + e2e |

## Layout
```
src/app/(app)/…        pages (today, schedule, projects, clients, estimates, time, inbox, reports, settings)
src/app/api/…          JSON API (all authorization enforced here)
src/lib/engine/        pure logic: capacity, scheduler, estimate recommendations, email matching
src/lib/services/      database queries
src/lib/google/        OAuth, Calendar sync/publish, Gmail scan
src/lib/db/schema.ts   database schema (Drizzle); drizzle/ holds migrations
tests/unit, tests/e2e  Vitest and Playwright suites
public/sw.js           service worker (app shell cache; API never cached)
```
