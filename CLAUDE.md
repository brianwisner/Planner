# CLAUDE.md — guide for working on this repository

This repository belongs to Wisner Engineering, a small structural engineering firm. The owner is not a programmer: explain changes in plain English, make design decisions yourself, and keep things simple.

It contains two separate things:

| Folder | What it is |
|---|---|
| `planner/` | **The project planning web app** (the main thing). React + TypeScript + Vite, data in Supabase, hosted on GitHub Pages. |
| `index.html`, `css/`, `js/` (repo root) | A standalone **segmented shear wall analyzer** (SDPWS-2021 §4.3). Plain HTML/JS, no build step. It is also published at `/Who-knows/shear-wall/` by the deploy workflow. |

`.github/workflows/deploy.yml` builds `planner/` and publishes it (plus the shear wall tool) to GitHub Pages on every push to the default branch.

---

## The planner app

### Data model (Supabase / Postgres) — `planner/supabase/setup.sql`

`clients → jobs → phases → tasks`, plus `time_entries`, `invoices`, `comments`, `profiles` (one per login), and a single-row `settings` table.

- Every job gets **four phases automatically** via a database trigger (`add_standard_phases`): `design`, `plan_check`, `construction`, `client_changes`. Phase `kind` is fixed; `name` is the label.
- `jobs.priority` (integer, lower = higher in queue) drives the prioritized job table.
- `time_entries.hours` is null while a timer is running (`started_at` set). Stopping the timer fills `hours` (rounded to quarter hours).
- `time_entries.billed` + `invoice_id` link hours to invoices. "Unbilled $" = unbilled hours × the person's `hourly_rate` (or `settings.default_rate`).
- `profiles` rows are created by a trigger on `auth.users` (`handle_new_user`). The first-ever user also gets the sample data assigned to them.
- Security: Row Level Security is on; one policy per table lets any **authenticated** user read/write everything (small trusted team). The anon key alone cannot read data.
- Realtime: every table is in the `supabase_realtime` publication.
- `clients.is_sample` marks seed data so Settings → "Remove sample data" can delete it.

**Changing the schema:** edit `setup.sql` so a fresh project still works, AND give the owner a small separate SQL snippet (`alter table … add column …`) to paste into the Supabase SQL Editor for their existing project. Then update `src/lib/types.ts`.

### Frontend layout — `planner/src/`

```
main.tsx            entry
App.tsx             auth gate (Login / SetPassword) + HashRouter routes + Layout
lib/
  supabase.ts       client; reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
  types.ts          row types + label maps (status labels, phase names)
  store.tsx         DataProvider / useData(): loads ALL tables once, subscribes to
                    realtime, exposes insert/update/remove (optimistic) + toast
  calc.ts           hours, billing and workload math (shared by pages)
  calendar.ts       calendar items from jobs/phases/tasks, Google link, .ics builder
  reminders.ts      once-a-day browser notification of overdue/due-today items
  utils.ts          date/money/hours formatting, CSV download, recurrence
components/
  Layout.tsx        sidebar (desktop) / bottom tabs (phone), top bar, timer pill,
                    quick-add + log-hours + search + shortcuts modals, toasts
  ui.tsx            Icon, Avatar, Person, PersonSelect, status badges/selects,
                    DueBadge, Progress, Modal, Checkbox, Empty
  editors.tsx       TaskModal, JobModal, ClientModal, TimeModal, InvoiceModal,
                    toggleTaskDone (handles recurring tasks)
  SearchPalette.tsx global search (/)
  Shortcuts.tsx     keyboard shortcut hook + help modal
views/              reusable big views used inside pages
  JobsTable.tsx     sortable table, drag-to-reorder priority (dnd-kit sortable)
  Kanban.tsx        task board, drag between status columns (dnd-kit)
  Gantt.tsx         timeline: job bar + one bar per phase, hours-used shading
  CalendarView.tsx  month grid + agenda list
pages/              one file per route
  Dashboard, Jobs (Table/Board/Gantt/Calendar tabs), JobDetail, Clients,
  ClientDetail, CalendarPage, Time, Billing (+ per-job detail), Reports, Settings, Login
index.css           all styles; CSS variables at top; mobile rules at bottom (@media max-width: 760px)
```

Conventions:
- Pages never call Supabase directly; they use `useData()` from `store.tsx`. The store holds every table in memory (fine for a small firm) and refetches a table whenever Supabase realtime reports a change.
- `update()` is optimistic (UI changes instantly, then saves). `insert()` returns the created row.
- Routing uses `HashRouter` (`#/jobs/123`) so GitHub Pages never 404s. Deep links: `/jobs/:id?task=<id>` opens a task, `/billing?job=<id>` opens job billing, `/time?entry=<id>` opens a time entry.
- Hours display in quarter hours (`fmtHours`). Money via `fmtMoney`.
- Keep touch targets ≥ 40px; `hide-mobile` class hides non-essential columns on phones.
- No CSS framework, no icon library (icons are inline SVG paths in `ui.tsx`).

### Google Calendar

`planner/supabase/functions/ics/index.ts` is a Supabase Edge Function that returns an `.ics` feed for `?token=<profiles.ics_token>` (optionally `&mine=1`). It must be deployed with JWT verification OFF. Settings page shows each user their link. Client-side fallbacks: "Download .ics" and per-item Google Calendar links (`lib/calendar.ts`).

### Build / deploy

- `cd planner && npm run build` must pass (`tsc -b && vite build`). `npm run lint` is oxlint (warnings only).
- `vite.config.ts` has `base: '/Who-knows/'` — change it if the repo is renamed.
- Deploy: GitHub Actions workflow reads repository **variables** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, builds, copies the shear-wall tool into `dist/shear-wall/`, publishes to Pages.
- There is no automated test suite. A throwaway Playwright harness with a fake Supabase backend was used during development (mock PostgREST routes + seeded session); recreate something similar if you need to click through the UI without a real project.

### Things the owner is likely to ask for

- New fields on jobs/phases/tasks → `setup.sql` (+ migration snippet), `types.ts`, the relevant modal in `editors.tsx`, and wherever it's displayed.
- New phase types → the `kind` check constraint in `setup.sql`, `add_standard_phases()`, `PHASE_KIND_LABEL`/`PHASE_KIND_SHORT` in `types.ts`, Gantt colors in `index.css` (`.gbar.<kind>`).
- Email reminders → would need a scheduled Edge Function (pg_cron + an email provider); currently reminders are browser notifications only.
- Two-way Google Calendar → needs Google OAuth (Google Cloud project); current design is a one-way subscription feed.
