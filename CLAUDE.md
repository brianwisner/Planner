# CLAUDE.md — guide for working on this repository

This repository belongs to Wisner Engineering, a small structural engineering firm. The owner is not a programmer: explain changes in plain English, make design decisions yourself, and keep things simple.

**Current product direction:** the owner works alone. The UI has no assignment
controls, staff list, person filters, or person reports. New tasks, hours, and
schedules use the signed-in owner. Existing ownership fields remain in the schema
for historical records, and all business work stays visible regardless of those
fields. `soloWorkload()` includes all active-job phases, including unassigned work,
and uses the owner's weekly capacity. See `AGENTS.md` for current working guidance.

It contains two separate things:

| Folder | What it is |
|---|---|
| `planner/` | **The project planning web app** (the main thing). React + TypeScript + Vite, data in Supabase, hosted on GitHub Pages. |
| `index.html`, `css/`, `js/` (repo root) | A standalone **segmented shear wall analyzer** (SDPWS-2021 §4.3). Plain HTML/JS, no build step. It is also published at `/Who-knows/shear-wall/` by the deploy workflow. |

`.github/workflows/deploy.yml` builds `planner/` and publishes it (plus the shear wall tool) to GitHub Pages on every push to the default branch.

---

## The planner app

### Data model (Supabase / Postgres) — `planner/supabase/setup.sql`

`clients → jobs → phases → tasks`, plus `time_entries`, `job_items`, `invoices`, `comments`, `profiles` (one per login), and a single-row `settings` table.

- Every job gets **six phases automatically** via a database trigger (`add_standard_phases`): `bidding`, `queued`, `design`, `plan_check`, `construction`, `client_changes`. Phase `kind` is fixed; `name` is the label. `calc.ts` `workPhase()` picks the phase new hours/schedules default to (first unfinished phase that isn't `queued`).
- `jobs.queued_date` = when the job entered the queue (separate from `start_date`). Auto-filled with today when the Queued phase is first moved off "not started" (`pages/JobDetail.tsx` PhaseCard); editable in JobModal. Shown as a teal diamond on the Gantt.
- `jobs.priority` (integer, lower = higher in queue) drives the prioritized job table.
- Job statuses are Active, On hold, Complete, Cancelled, and Archived. The job-title and Jobs-table status selectors save directly. Cancelled keeps all history and money records but removes pending deadlines/tasks and planned hours from capacity totals; changing back to Active restores them.
- `time_entries.hours` is null while a timer is running (`started_at` set). Stopping the timer fills `hours` (rounded to quarter hours).
- `time_entries.billable` defaults to true, including existing records. Nonbillable time retains its saved rate, actual hours, and work value in estimates and the job balance, but cannot consume deposits or be invoiced. Reclassifying billed/invoice-linked/credited time requires explicit Unbill first; both the UI and database enforce this.
- `time_entries.billed` + `invoice_id` link hours to invoices. `time_entries.rate` is the $/hour saved on insert by the `time_entry_rate` trigger (person's `hourly_rate`, else `settings.default_rate`), so rate changes never rewrite past hours.
- `schedule_entries` (job_id, phase_id, user_id, date, hours): **planned** hours (not worked time), created by dragging on the Gantt chart via `components/ScheduleModal.tsx`. The app merges by (job, phase, person, date): editing updates the row, 0/blank deletes it.
- `job_items` (job_id, date, category, description, quantity, unit_price, billed, invoice_id): billable **charges** that aren't hours (expenses, mileage, fees). Amount = quantity × unit_price. Edited in `ItemModal` (`editors.tsx`); invoiced alongside hours.
- `deposits` (job_id, amount, received_date, method, notes): retainers. `jobCharges()` applies them to a job's **un-invoiced** hours and charges oldest-first; the invoice RPC independently validates the same allocation before saving.
- Invoiced work retains `deposit_applied` on each time entry/charge. `jobCharges()` reserves these saved credits before allocating remaining deposits, and only the remainder counts as awaiting invoice payment. New invoices use the `record_invoice` RPC to validate the form's original amounts/credits and save all links atomically. Invoice deletion/unbilling clears credits; legacy `NULL` credits are never inferred from editable invoice amounts. Work with a saved credit must be unbilled before moving jobs or reducing its value below that credit.
- `tasks.recurrence_parent_id` uniquely links each generated occurrence to its predecessor. All completion paths use `lib/taskActions.ts`; reopening/completing again reuses the successor. Legacy matching excludes ancestors and checks original as well as edited attributes. Completion and successor creation are two writes; a failed successor reports an error and can be retried by saving the completed task again.
- Money model lives in `src/lib/calc.ts`:
  - `jobHours()` gives each entry a status: `deposit` (paid by deposit), `partial`, `unbilled`, `billed` (on an unpaid invoice), `paid` (invoice paid).
  - `jobBilling()` totals per job; **balance = deposits + invoiced − work value** (work value = hours value + charges value) (the owner's definition of job profitability: drops as hours are logged, rises when a deposit arrives or an invoice is sent). `collected` = deposits + paid invoices.
  - Billable/nonbillable hours and `nonBillableValue` split completed effort without subtracting it twice. `feeRevenue` uses recorded deposits + invoices once, less funded separate charges: deposit-covered charges plus each invoice's linked net charges up to its amount. Custom invoices fund linked charges before fees; standalone invoices count as fees. `effectiveHourlyRate = feeRevenue / all completed hours`, including nonbillable time, or null before any completed hours. It includes unused deposits and is before overhead/tax. Running timers are excluded from this rate until stopped. `FeesSummary` displays the same lifetime basis on Job detail and job Billing; Reports keeps its hours within the selected dates.
  - `balanceHistory()` feeds the step chart; `depositUsage()` splits usage across deposits; `allHours()` is the cross-job status map.
  - UI: `pages/Billing.tsx` (tabs Jobs / Deposits / Hours, and `?job=<id>` job money view), `components/MoneyCharts.tsx` (work-status bar + balance chart, status palette good #0ca30c / warning #fab219 / critical #d03b3b, always with text labels).
- `profiles` rows are created by a trigger on `auth.users` (`handle_new_user`). The first-ever user also gets the sample data assigned to them.
- Security: Row Level Security is on; one policy per table lets any **authenticated** user read/write everything (small trusted team). The anon key alone cannot read data.
- Realtime: every table is in the `supabase_realtime` publication.
- `clients.is_sample` marks seed data so Settings → "Remove sample data" can delete it.

**Changing the schema:** edit `setup.sql` so a fresh project still works, AND give the owner a small separate SQL snippet (`alter table … add column …`) to paste into the Supabase SQL Editor for their existing project. Then update `src/lib/types.ts`.

The existing-project migration for Cancelled is `planner/supabase/migrations/20261017182411_add_cancelled_job_status.sql`. It is applied to the live project, and the updated `ics` Edge Function is deployed so subscribed calendars omit cancelled work. Keep migration filenames aligned with the live migration history.

The recurrence/deposit migration was applied to the live project on 2026-10-18: `planner/supabase/migrations/20261018201758_preserve_deposit_credits_and_recurring_task_parent.sql`. It adds the columns, constraints, normalization trigger, and atomic invoicing RPC without backfilling financial history. See `planner/supabase/README.md` for rollout and disposable-database checks.

The billable-hours migration was applied to the live project on 2026-10-18: `planner/supabase/migrations/20261018203905_add_billable_time_entries.sql`. It adds the default-true field and financial-link constraint, updates the existing trigger/RPC to reject nonbillable invoice work, and preserves prior records. Other existing projects must apply it before deploying the matching frontend. Its synthetic checks are `planner/supabase/tests/billable_hours.sql`.

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
  billingActions.ts captures invoice work values and deposit credits when the form opens
  taskActions.ts    shared task completion, recurrence, duplicate prevention, retry handling
  calendar.ts       calendar items from jobs/phases/tasks, Google link, .ics builder
  reminders.ts      once-a-day browser notification of overdue/due-today items
  utils.ts          date/money/hours formatting, CSV download, recurrence
components/
  Layout.tsx        sidebar (desktop) / bottom tabs (phone), top bar, timer pill,
                    quick-add + log-hours + search + shortcuts modals, toasts
  ui.tsx            Icon, Avatar, Person, PersonSelect, status badges/selects,
                    DueBadge, Progress, Modal, Checkbox, Empty
  editors.tsx       TaskModal, JobModal, ClientModal, TimeModal, InvoiceModal,
                    re-exports toggleTaskDone from taskActions.ts
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
- `update()` is optimistic (UI changes instantly, then saves) and verifies an updated row before returning a success boolean. `remove()` returns a success boolean; `insert()` returns the created row. `recordInvoice()` calls the atomic SQL function and refreshes data after success.
- Routing uses `HashRouter` (`#/jobs/123`) so GitHub Pages never 404s. Deep links: `/jobs/:id?task=<id>` opens a task, `/billing?job=<id>` opens job billing, `/time?entry=<id>` opens a time entry.
- Hours display in quarter hours (`fmtHours`). Money via `fmtMoney`.
- Keep touch targets ≥ 40px; `hide-mobile` class hides non-essential columns on phones.
- The owner specifically prefers compact job-status dropdowns: 28px high on desktop, 30px on phones, with an inset chevron and room between the label and arrow. Preserve this sizing when editing the shared control.
- Phone navigation has Dashboard, Jobs, Calendar, Time, and a More menu for Clients, Billing, Reports, and Settings. Log hours and Add task are visible in the top bar.
- No CSS framework, no icon library (icons are inline SVG paths in `ui.tsx`).

### Google Calendar

`planner/supabase/functions/ics/index.ts` is a Supabase Edge Function that returns an `.ics` feed for `?token=<profiles.ics_token>` (optionally `&mine=1`). It must be deployed with JWT verification OFF. Settings page shows each user their link. Client-side fallbacks: "Download .ics" and per-item Google Calendar links (`lib/calendar.ts`).

### Build / deploy

- `cd planner && npm run build` must pass (`tsc -b && vite build`). `npm run lint` is oxlint (warnings only).
- `vite.config.ts` has `base: '/Who-knows/'` — change it if the repo is renamed.
- Deploy: GitHub Actions workflow builds (Vite reads `planner/.env.production`, which holds the Supabase URL and *publishable* key — public by design), copies the shear-wall tool into `dist/shear-wall/`, and pushes the result to the `gh-pages` branch, which GitHub Pages serves. `.env.production` is deliberately un-ignored in `planner/.gitignore`.
- Live Supabase project: `wisner-planner` (ref `axjyhkyvmbrhtivgofya`, us-east-1). Schema was applied with the Supabase MCP `execute_sql` tool in chunks; note that statements containing `drop …` make that tool wait for a confirmation that never arrives in a cloud session (60s timeout), so write migrations without DROP or run them from the dashboard.
- Creating logins without the dashboard: insert into `auth.users` + `auth.identities` via SQL (see conversation history / Supabase docs); the `on_auth_user_created` trigger then creates the profile. Password resets by email need Site URL set in Supabase Auth settings, which the MCP cannot change.
- Run `npm test` for Vitest calculation, recurrence, and synthetic form regressions. `.github/workflows/checks.yml` runs tests, build, and lint on pull requests. SQL regressions in `planner/supabase/tests/` are for a disposable local database; never run test writes against customer records. Lint currently has existing React warnings; errors must pass.

### Things the owner is likely to ask for

- New fields on jobs/phases/tasks → `setup.sql` (+ migration snippet), `types.ts`, the relevant modal in `editors.tsx`, and wherever it's displayed.
- New phase types → the `kind` check constraint in `setup.sql`, `add_standard_phases()`, `PHASE_KIND_LABEL`/`PHASE_KIND_SHORT` in `types.ts`, Gantt colors in `index.css` (`.gbar.<kind>`).
- Email reminders → would need a scheduled Edge Function (pg_cron + an email provider); currently reminders are browser notifications only.
- Two-way Google Calendar → needs Google OAuth (Google Cloud project); current design is a one-way subscription feed.
- **Google sign-in + showing the owner's work Google Calendar** was built once (commit 8df26c9) and then reverted at the owner's request ("connect my work account later"). To bring it back: revert the revert commit, then do the Google Cloud OAuth client + Supabase Google provider setup. The live database still has the dormant pieces (`google_tokens`, `private_config`, `settings.allowed_email_domains`, `profiles.google_calendar_ids`, and the `google-calendar` edge function); they are unused.
