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
- `time_entries.billed` + `invoice_id` link hours to invoices. `time_entries.rate` is the $/hour saved on insert by the `time_entry_rate` trigger (person's `hourly_rate`, else `settings.default_rate`), so rate changes never rewrite past hours.
- `schedule_entries` (job_id, phase_id, user_id, date, hours): **planned** hours (not worked time), created by dragging on the Gantt chart via `components/ScheduleModal.tsx`. The app merges by (job, phase, person, date): editing updates the row, 0/blank deletes it.
- `deposits` (job_id, amount, received_date, method, notes): retainers. The app (not the DB) applies them to a job's **un-invoiced** hours oldest-first.
- Money model lives in `src/lib/calc.ts`:
  - `jobHours()` gives each entry a status: `deposit` (paid by deposit), `partial`, `unbilled`, `billed` (on an unpaid invoice), `paid` (invoice paid).
  - `jobBilling()` totals per job; **balance = deposits + invoiced − work value** (the owner's definition of job profitability: drops as hours are logged, rises when a deposit arrives or an invoice is sent). `collected` = deposits + paid invoices.
  - `balanceHistory()` feeds the step chart; `depositUsage()` splits usage across deposits; `allHours()` is the cross-job status map.
  - UI: `pages/Billing.tsx` (tabs Jobs / Deposits / Hours, and `?job=<id>` job money view), `components/MoneyCharts.tsx` (work-status bar + balance chart, status palette good #0ca30c / warning #fab219 / critical #d03b3b, always with text labels).
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
  JobsTable.tsx     sortable table, drag-to-reorder priority (dnd-kit sortable);
                    `schedulable` prop (Jobs page) adds the "Plan hours" week grid:
                    DayCell inputs write schedule_entries on the job's current phase,
                    tfoot = person's daily totals; >1 phase on a day opens ScheduleModal
  Kanban.tsx        task board, drag between status columns (dnd-kit)
  Gantt.tsx         timeline: sticky job/phase column + sticky date header (month / date /
                    weekday letter M T W R F S U / scheduled hours per day for a chosen
                    person); jobs roll up (collapsed set in localStorage); drag (mouse) or
                    tap (touch) on a row opens ScheduleModal; grid + weekends are CSS
                    gradients so rows stay light
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
- Deploy: GitHub Actions workflow builds (Vite reads `planner/.env.production`, which holds the Supabase URL and *publishable* key — public by design), copies the shear-wall tool into `dist/shear-wall/`, and pushes the result to the `gh-pages` branch, which GitHub Pages serves. `.env.production` is deliberately un-ignored in `planner/.gitignore`.
- Live Supabase project: `wisner-planner` (ref `axjyhkyvmbrhtivgofya`, us-east-1). Schema was applied with the Supabase MCP `execute_sql` tool in chunks; note that statements containing `drop …` make that tool wait for a confirmation that never arrives in a cloud session (60s timeout), so write migrations without DROP or run them from the dashboard.
- Creating logins without the dashboard: insert into `auth.users` + `auth.identities` via SQL (see conversation history / Supabase docs); the `on_auth_user_created` trigger then creates the profile. Password resets by email need Site URL set in Supabase Auth settings, which the MCP cannot change.
- There is no automated test suite. A throwaway Playwright harness with a fake Supabase backend was used during development (mock PostgREST routes + seeded session); recreate something similar if you need to click through the UI without a real project.

### Things the owner is likely to ask for

- New fields on jobs/phases/tasks → `setup.sql` (+ migration snippet), `types.ts`, the relevant modal in `editors.tsx`, and wherever it's displayed.
- New phase types → the `kind` check constraint in `setup.sql`, `add_standard_phases()`, `PHASE_KIND_LABEL`/`PHASE_KIND_SHORT` in `types.ts`, Gantt colors in `index.css` (`.gbar.<kind>`).
- Email reminders → would need a scheduled Edge Function (pg_cron + an email provider); currently reminders are browser notifications only.
- Two-way Google Calendar → needs Google OAuth (Google Cloud project); current design is a one-way subscription feed.
- **Google sign-in + showing the owner's work Google Calendar** was built once (commit 8df26c9) and then reverted at the owner's request ("connect my work account later"). To bring it back: revert the revert commit, then do the Google Cloud OAuth client + Supabase Google provider setup. The live database still has the dormant pieces (`google_tokens`, `private_config`, `settings.allowed_email_domains`, `profiles.google_calendar_ids`, and the `google-calendar` edge function); they are unused.
