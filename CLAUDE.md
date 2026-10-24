# CLAUDE.md — guide for working on this repository

This repository belongs to Wisner Engineering, a small structural engineering firm. The owner is not a programmer: explain changes in plain English, make design decisions yourself, and keep things simple.

**Current product direction:** the owner works alone. The UI has no assignment
controls, staff list, person filters, or person reports. New tasks, hours, and
schedules use the signed-in owner. Existing ownership fields remain in the schema
for historical records, and all business work stays visible regardless of those
fields. `soloWorkload()` includes all active-job phases, including unassigned work,
and uses the owner's weekly capacity. See `AGENTS.md` for current working guidance.

It contains:

| Folder | What it is |
|---|---|
| `planner/` | **The project planning web app** (the main thing, version 2 — rebuilt Oct 2026). React + TypeScript + Vite, data in Supabase, hosted on GitHub Pages at https://brianwisner.github.io/Planner/ (the repository is `brianwisner/Planner`, renamed from `Who-knows` in Oct 2026; use the capital P in links). `planner/supabase/` holds the database schema, migrations and the calendar-feed Edge Function. |
| `classic/` | The **previous design** of the planner (frozen). Same database. Published at `/Planner/classic/` as a fallback; safe to delete later (also remove its steps from both workflows). Don't develop it further. |

`.github/workflows/deploy.yml` builds `planner/` (plus a demo build at `/Planner/demo/` and `classic/` at `/Planner/classic/`) and publishes to GitHub Pages on every push to the default branch, `main` (renamed in Oct 2026 from `claude/shear-wall-analyzer-kQe3k`, a name left over from when this repository started). `.github/workflows/checks.yml` runs tests, build, lint, the demo build and the classic build on pull requests.

The shear wall analyzer that used to sit at this repository's root is kept in its own repository (`brianwisner/shear-wall`) as an archive; the owner doesn't use it, so it isn't published as a website. It is unrelated to the planner: don't link to it or add it back here.

---

## The planner app

### Data model (Supabase / Postgres) — `planner/supabase/setup.sql`

`clients → jobs → phases → tasks`, plus `job_types`, `past_jobs`, `quotes`, `time_entries`, `job_items`, `invoices`, `deposits`, `schedule_entries`, `comments`, `site_visits` + `site_photos`, `plan_check_rounds` + `plan_check_comments`, `profiles` (one per login), and a single-row `settings` table.

- New jobs get **five phases automatically** via the `add_standard_phases` trigger: `bidding`, `design`, `plan_check`, `construction`, `client_changes`. Older jobs may also have a retired `queued` phase: it is stored history only (`lib/phases.ts` `isWorkflowPhase()` excludes it; label "Planning history"). Phase `kind` is fixed; `name` is the label. `calc.ts` `workPhase()` picks the phase new hours/schedules default to (first unfinished workflow phase).
- **Stages (v2 UI concept, no schema):** `lib/stages.ts` derives a job's pipeline stage from its phase statuses — Bidding · Ready to start · Design · Plan check · Construction. The most advanced main phase that is in progress/waiting wins; with none started, the first unfinished main phase decides (bidding not started → Bidding, design not started after bidding → Ready to start, later phases → that column, "not started"). `client_changes` is side work shown as a chip, never a stage. `stageChanges()` returns the phase status edits that put a job in a stage (earlier main phases complete, target started, later started phases reset; client changes untouched); the board, the job-page stepper and the card menus all use it via `lib/jobActions.ts` `moveJobToStage()`, which offers Undo.
- **Fee estimator** (Money → Fee estimator, `/money?tab=estimate&job=&type=`; `lib/estimate.ts`, `pages/FeeEstimator.tsx`):
  - `job_types` hold starter hours for Design, Plan check and Construction (construction **excluding** site visits), the usual number of `site_visits`, and an optional `size_unit`. `jobs.job_type_id` links jobs to a type; `jobs.size` is in that unit.
  - Typical hours = starter numbers (usual visits × `settings.site_visit_hours` added to Construction) counted as 2 jobs (`STARTER_WEIGHT`) blended with the fee-phase hours of **complete/archived** jobs of that type with `use_in_estimates` true (`estimate_note` says why one was left out). Hours with no phase count as Design and are flagged; bidding and client changes are not part of the fee.
  - Pricing (`priceEstimate`): the owner can edit each phase's hours; visits above/below the type's usual adjust Construction; an allowance for unknowns is spread across phases; rush % is added; fee = hours × rate, rounded up to the next $50, never below `settings.minimum_fee`. A fee that differs from the suggestion asks for a reason.
  - Evidence: past range and middle job, earned per hour vs. the **rates saved on those hours** (not today's rate), hours/fee per size unit, phases that ran over their quote on most jobs, and closeout reasons.
  - "Save quote" inserts a `quotes` row (never edited, so the original survives; the latest one is the job's baseline) and sets the job's fee, type, size and phase estimates (with Undo). The job page's **Quote vs. actual** card compares the latest quote with actual hours, warns while active, and on closed jobs asks for a `closeout_reason` (`CLOSEOUT_REASONS`) and the use-in-estimates switch.
  - **Automatic typing** (`lib/jobTyping.ts` `guessType`): a job's name + scope is matched against each type's `keywords` (phrases count), its name, and words learned from jobs and `past_jobs` already of that type. New jobs get the guess until a type is picked by hand; the job form suggests one for untyped jobs; the estimator guesses for an untyped job; Job types → "Sort them" bulk-assigns guesses (with Undo).
  - `past_jobs` = jobs from before the planner (found in invoices, email, files): fee evidence ("Before the planner you charged …"), listed under "From your records" (each can be left out), and typing examples. They don't blend into hours (starter hours were derived from them). A type with no hours falls back to the average of the other types (`fallbackHours`), labeled as a best guess.
  - Proposal text comes from `settings.proposal_template` (blank = `DEFAULT_PROPOSAL_TEMPLATE`; fields like `{fee}` listed in `PROPOSAL_FIELDS`; a line whose fields are all blank is dropped). `settings.retainer_percent` adds the retainer line. Copy, Email (Gmail) and a preview are on the estimator; the wording is edited in Settings → Fee estimator and proposals (`/settings#estimator`).
- **Site visit reports** (job tab "Site visits", `/jobs/:id/visits/:visitId`, printable at `…/report`; `lib/siteVisits.ts`, `pages/SiteVisitPage.tsx`, `pages/SiteVisitReport.tsx`):
  - `site_visits` holds the visit date, purpose, who was there, weather, `observations` and `corrections` (one item per line, numbered on the report), the closing paragraph (`conclusion`, starts from `settings.visit_closing` or `DEFAULT_VISIT_CLOSING`), `sent_date`, and the scheduled site-visit `task_id` it came from.
  - `/jobs/:id/visits/new` (optionally `?task=`) is not saved until something is typed or a photo added, then it becomes a real row and the address changes; fields autosave 0.8 s after typing. A new report prefills from a site-visit task in the last 3 days without a report. Existing site-visit tasks show "Start/Open report" in the task form.
  - Photos: `prepareImage()` shrinks each to 1600 px JPEG on the device, uploads to the **private storage bucket `site-photos`** (path `job/visit/uuid.jpg`, policies `site_photos_*` for authenticated users), and a `site_photos` row keeps caption/order. Photos show through signed links cached 12 h (`usePhotoUrls`). Deleting a photo, visit or job also removes the files (`deletePhoto`, `deleteVisit`, `jobPhotoPaths`). The demo mock has an in-memory storage stand-in with drawn sample photos.
- **Plan check** (job tab "Plan check", letter at `/jobs/:id/plan-check/:roundId`; `lib/planCheck.ts`, `components/JobPlanCheck.tsx`, `pages/PlanCheckLetter.tsx`):
  - `plan_check_rounds` (round number, agency, reviewer, permit number, comment-letter date, `sent_date`, cover `notes`) → `plan_check_comments` (reviewer's `number`, `comment`, `response`, `done`, `sort_order`).
  - `parseComments()` splits a pasted comment letter: numbered lines ("1.", "2)", "S-3:", "Comment 4 –") start comments and wrapped lines/sub-items stay with them; else bullets; else paragraphs/lines (tested). Responses autosave on blur.
  - Adding comments moves a job still before Plan check into it (Undo) and sets a waiting plan check back to in progress (`startPlanCheckWork`); "Mark sent" sets `sent_date` and the plan check phase to Waiting (`markRoundSent`, Undo). Board cards in Plan check show "3 of 7 open" / "Responses ready"; moving a job past Plan check with open comments says so in the toast.
- Letters and reports share `components/Letterhead.tsx` + `pages/letter.css` (paper look like invoices). `settings.letterhead` (lines under the company name, also on invoices) and `settings.signature` are edited in Settings → Letters and reports (`/settings#letters`).
- `jobs.queued_date` is legacy storage (no longer shown). `jobs.priority` (lower = higher in queue) drives the List view order; `jobActions.mergeOrder()` keeps hidden jobs in place when a filtered list is reordered.
- Job statuses are Active, On hold, Complete, Cancelled, and Archived. Cancelled keeps all history and money records but removes pending deadlines/tasks and planned hours from capacity totals; changing back to Active restores them.
- `time_entries.hours` is null while a timer is running (`started_at` set). Stopping the timer fills `hours` (rounded to quarter hours, minimum 0.25). Only one timer runs at a time (`lib/timer.ts` stops others first; a second click while a start is saving reuses it). A timer running over 12 hours is never saved automatically: Stop opens the hours form (`components/useTimerActions.ts`), and a new start is refused until it's fixed. Time shows every running timer if there are ever several.
- `time_entries.billable` defaults to true, including existing records. Nonbillable time retains its saved rate, actual hours, and work value in estimates and the job balance, but cannot consume deposits or be invoiced. Reclassifying billed/invoice-linked/credited time requires explicit Unbill first; both the UI and database enforce this.
- `time_entries.billed` + `invoice_id` link hours to invoices. In v2 the forms also keep the **hours, date and rate** of invoice-linked time (and the quantity, price and date of invoice-linked charges) as billed, so a reprinted invoice never changes; Unbill first to edit them. The invoice form sends the amounts and deposit credits it showed when it opened, so `record_invoice` rejects a form that went stale. The weekly timesheet never edits billed, credited or running entries, and asks before deleting an entry when a box is cleared (Esc cancels a typed change). `time_entries.rate` is the $/hour saved on insert by the `time_entry_rate` trigger (person's `hourly_rate`, else `settings.default_rate`), so rate changes never rewrite past hours.
- `schedule_entries` (job_id, phase_id, user_id, date, hours): **planned** hours (not worked time). Edited in Schedule → Week plan (type into a cell) via `lib/schedule.ts` `setPlannedHours()`: one row per (job, phase, owner, day); editing updates it, 0/blank deletes it; a day with plans on several phases opens a per-phase editor; other people's historical plans are left alone and shown separately.
- `job_items` (job_id, date, category, description, quantity, unit_price, billed, invoice_id): billable **charges** that aren't hours (expenses, mileage, fees). Amount = quantity × unit_price.
- `deposits` (job_id, amount, received_date, method, notes): retainers. `jobCharges()` applies them to a job's **un-invoiced** hours and charges oldest-first; the invoice RPC independently validates the same allocation before saving.
- Invoiced work retains `deposit_applied` on each time entry/charge. `jobCharges()` reserves these saved credits before allocating remaining deposits, and only the remainder counts as awaiting invoice payment. New invoices use the `record_invoice` RPC (`store.recordInvoice()`) to validate the form's original amounts/credits and save all links atomically. Invoice deletion/unbilling clears credits; legacy `NULL` credits are never inferred from editable invoice amounts. Work with a saved credit must be unbilled before moving jobs or reducing its value below that credit.
- `tasks.recurrence_parent_id` uniquely links each generated occurrence to its predecessor. All completion paths use `lib/taskActions.ts`; reopening/completing again reuses the successor. Completion and successor creation are two writes; a failed successor reports an error and can be retried by saving the completed task again.
- Money model lives in `src/lib/calc.ts` (unchanged from v1, fully tested):
  - `jobHours()` gives each entry a status: `deposit`, `partial`, `unbilled`, `billed` (unpaid invoice), `paid`, `nonbillable`.
  - `jobBilling()` totals per job; **balance = deposits + invoiced − work value** (the owner's definition of job profitability). `collected` = deposits + paid invoices.
  - `feeRevenue` uses recorded deposits + invoices once, less funded separate charges. `effectiveHourlyRate = feeRevenue / all completed hours` ("Earned per hour" in the UI), including nonbillable time, or null before any completed hours. Running timers are excluded until stopped.
  - `balanceHistory()` feeds the balance chart; `depositUsage()` splits usage across deposits; `allHours()` is the cross-job status map.
- **Planning tables added by GPT in Oct 2026** (`daily_reviews`, `follow_ups`, `daily_availability`, `availability_blocks`, `job_planning`, `job_decisions`, `planning_events`, migration `20261019045305`) exist in the live database but are **not used by v2** (they were empty). The classic app still reads them. Don't drop them without asking the owner.
- `profiles` rows are created by a trigger on `auth.users` (`handle_new_user`).
- Security: Row Level Security is on; one policy per table lets any **authenticated** user read/write everything. The anon key alone cannot read data.
- Realtime: every table is in the `supabase_realtime` publication.
- `clients.is_sample` marks seed data so Settings → "Remove sample data" can delete it.

**Changing the schema:** edit `setup.sql` so a fresh project still works, AND add a migration under `planner/supabase/migrations/` / give the owner a small SQL snippet for the existing project. Then update `src/lib/types.ts` (and the demo `DEFAULTS` in `src/demo/mockSupabase.ts`).

Applied migrations (keep filenames aligned with the live history): `20261017182411_add_cancelled_job_status`, `20261018201758_preserve_deposit_credits_and_recurring_task_parent`, `20261018203905_add_billable_time_entries`, `20261019021910_retire_queued_phase_for_new_jobs`, `20261019045305_add_morning_review_planning`, `20261020031520_add_business_email`, `20261020084453_add_job_types_for_fee_estimator`, `20261021065135_fee_estimator_quotes_and_settings`, `20261021074050_job_type_keywords_and_past_jobs`, `20261022022559_client_job_priorities`, `20261024054004_site_visits_and_plan_check` (the live history also has `20261023052039_client_progress_read_only_capacity`, applied outside this repository). SQL regression suites in `planner/supabase/tests/` are for a disposable local database; never run test writes against customer records. v2 itself needed no schema change; the fee estimator added `job_types`, `quotes`, and job/settings fields.

### Frontend layout — `planner/src/`

```
main.tsx              entry: fonts, global CSS, theme
App.tsx               auth gate (Login / SetPassword) + HashRouter routes, legacy redirects
env.d.ts              __DEMO__ build flag
styles/
  tokens.css          ALL colors/sizes as CSS variables, light + dark (data-theme / prefers-color-scheme)
  base.css            reset, typography, utilities (row, stack, muted, hide-sm/show-sm …)
  components.css      buttons, cards, badges, stage chips, inputs, segmented, tabs, tables, lists,
                      dialog (bottom sheet on phones), menu, toasts, stats, palette, form bits
  layout.css          shell: sidebar, top bar, phone top bar, bottom tabs, + button, demo banner
lib/
  supabase.ts         client; DEMO swaps in demo/mockSupabase.ts (tree-shaken from production)
  store.tsx           DataProvider / useData(): loads ALL tables once, realtime refetch,
                      insert / insertMany / update (optimistic) / remove / recordInvoice / fetchWhere,
                      toasts with an optional action (only the latest Undo is kept)
  types.ts            row types + label maps
  calc.ts             hours, billing and workload math            (+ calc.test.ts)
  stages.ts           pipeline stage from phases; stage moves       (+ stages.test.ts)
  jobActions.ts       moveJobToStage, setJobStatus (with Undo), mergeOrder/reorderJobs
  views.ts            summarizeJob, taskOrder, openAgenda, weekDays, lateCount, greeting
  schedule.ts         setPlannedHours (planned-hours rules)
  timer.ts            start/stop timer, elapsed label
  taskActions.ts      task save/complete + recurrence (shared by every view)
  billingActions.ts   captures invoice work values and deposit credits
  estimate.ts         fee estimator: blended hours, pricing, overruns, per-size, past records, proposal text   (+ estimate.test.ts)
  jobTyping.ts        guess a job's type from its name/scope (key words + learned words)   (+ jobTyping.test.ts)
  calendar.ts         calendar items, Google link, .ics builder
  phases.ts           workflow vs retired phases
  reminders.ts        once-a-day browser notification (off in demo)
  theme.ts            light/dark/system + small per-device prefs (localStorage keys prefixed `wp2:`)
  utils.ts            date/money/hours formatting, CSV/text download
  email.ts            Gmail "new message" links for every email button   (+ email.test.ts)
  siteVisits.ts       site visit helpers, photo shrink/upload/delete, signed photo links   (+ siteVisits.test.ts)
  planCheck.ts        paste parser, round status, start/mark-sent actions   (+ planCheck.test.ts)
demo/
  mockSupabase.ts     in-memory stand-in for the Supabase client (subset the app uses,
                      incl. triggers: phases on job insert, entry rate, cascades, record_invoice)
  seed.ts             made-up sample data relative to today (fictional names only)
components/
  Shell.tsx           sidebar (desktop, icon-only < 1100px), top bar (search, timer, New menu),
                      phone top bar + bottom tabs (Today, Jobs, Schedule, Time, More) + "+" sheet,
                      keyboard shortcuts, toasts, demo banner
  ui.tsx              Modal (focus trap, Esc, sheet on phone), ConfirmProvider/useConfirm, Menu,
                      StageChip, DueText, Progress, Avatar, TaskCheck, Empty, Segmented, Field,
                      NumberInput (keeps typed text)
  editors.tsx         EditorProvider + useEditors(): task, job, job type, client, time, deposit, charge,
                      invoice (pick unbilled work), mark paid. Billing-lock rules live here.
  CommandPalette.tsx  search + commands (/ or Ctrl/Cmd+K)
  TaskRow.tsx         task line: tick (with Undo), open, start timer
  JobMoneyPanel.tsx   job Billing tab: totals, status bar, balance chart, invoice work, invoices,
                      deposits, billed work (Unbill)
  JobPlanCheck.tsx    job Plan check tab: rounds, comments with responses, paste dialog
  JobSiteVisits.tsx   job Site visits tab: list of visit reports
  Letterhead.tsx      letterhead + signature for printed reports and letters
  MoneyCharts.tsx     WorkStatusBar, BalanceChart
  WeekStrip.tsx, PipelineBar.tsx, Brand.tsx
views/                big reusable views
  WeekPlanner.tsx     Schedule → Week plan grid (type planned hours)
  Timeline.tsx        Schedule → Timeline (drag phase bars / ends to change dates; click to set)
  MonthCalendar.tsx   Schedule → Calendar month grid + list (agenda, default on phones)
pages/                one file per route (+ its own .css)
  Today, Jobs (Board / List), JobPage (Overview / Hours & charges / Billing / Plan check / Site visits / Notes),
  SiteVisitPage (photos + notes), SiteVisitReport + PlanCheckLetter (printable, letter.css),
  Schedule, Time, Money (Overview / Ready to bill / Invoices / Deposits / Reports / Fee estimator → FeeEstimator.tsx),
  InvoiceView (printable invoice), Clients, ClientPage, Settings, Login
```

Routes (HashRouter, so GitHub Pages never 404s): `/` Today · `/jobs` (`?view=board|list&q=&client=&show=&stage=&sort=`) · `/jobs/:id` (`?tab=overview|time|billing|plancheck|visits|notes`, `?task=<id>` opens a task) · `/jobs/:id/visits/:visitId` (`new` starts one) and `…/report` · `/jobs/:id/plan-check/:roundId` (response letter) · `/schedule` (`?view=week|timeline|month&week=&month=`) · `/time` (`?week=`, `?entry=<id>` opens an entry) · `/money` (`?tab=…`) · `/money/invoice/:id` · `/clients`, `/clients/:id` · `/settings`. Old addresses redirect: `/billing?job=X` → job Billing tab, `/calendar` → Schedule calendar, `/reports` → Money reports, `/review`, `/follow-ups`, `/availability` → Today/Schedule.

Conventions:
- Pages never call Supabase directly; they use `useData()`. Open forms with `useEditors()`; ask for confirmation with `useConfirm()` (not `window.confirm`).
- Use the design tokens and shared classes; no hard-coded colors (dark mode must keep working). Stage colors come from `[data-stage=…]` → `--stage` / `--stage-soft`.
- Icons are `lucide-react`. Font is Inter (bundled via `@fontsource-variable/inter`).
- Hours display in quarter hours (`fmtHours`). Money via `fmtMoney`.
- Phones (≤ 760px): touch targets ≥ 40px, no sideways page scrolling (wide grids scroll inside their card), `hide-sm` for non-essential columns, dialogs become bottom sheets.
- The owner prefers compact job-status dropdowns: `.status-select` is 28px high on desktop, 30px on phones, with an inset chevron. Keep that.
- Esc and Tab act only on the top dialog (a New client form opened from New job closes alone).
- "Awaiting payment" everywhere uses `views.unpaidInvoices()`: unpaid, more than half a cent, on non-archived jobs. A $0 invoice shows "No payment due". Site-visit dates use the local day (`views.taskDay()`).
- Reordering the List view numbers open jobs 1, 2, 3… skipping numbers that closed jobs still hold (`priorityNumbers()`); new jobs get the highest number + 1.
- Today: tasks/deadlines cover active and on-hold jobs; tasks "Waiting on someone" are listed separately and never count as late. Financial totals retain all nonarchived jobs, including completed/cancelled obligations.
- Email buttons open Gmail on the web (`lib/email.ts` `useEmailLink()`, sent from the signed-in owner's Gmail account), never `mailto:`: the owner uses Gmail, and the computer's default mail app is something else.
- Plain-English labels everywhere ("Earned per hour", "Ready to bill", "Waiting on someone").

### Demo mode

`npm run demo` (in `planner/`) opens the app with made-up data in memory — no login, nothing saved, nothing sent to Supabase. Use it for screenshots and click-through testing; **never test against live customer data**. The demo is also published at `/Planner/demo/` with a banner. The production build excludes the demo code (`__DEMO__` is defined false at build time).

### Google Calendar

`planner/supabase/functions/ics/index.ts` is a Supabase Edge Function that returns an `.ics` feed for `?token=<profiles.ics_token>`. It must be deployed with JWT verification OFF. Settings shows the link; Schedule → Calendar has a month `.ics` download and per-item "Add to Google Calendar" links. The contract test `index.contract.test.ts` runs with `npm test`.

### Build / deploy

- `cd planner && npm run build` must pass (`tsc -b && vite build`). `npm test` (Vitest) and `npm run lint` (oxlint, errors must pass; a few React-compiler warnings are acceptable).
- `vite.config.ts` and `classic/vite.config.ts` use relative paths (`base: './'`), so the built site works under any repository name (the address is `https://brianwisner.github.io/<repo name>/`). Renaming the repo needs no code change; only the Supabase Auth Site URL (password-reset emails) and docs mention the address. The demo is in `demo/`, so its links to the planner and classic go up one folder (`../`).
- `vite.config.ts` puts `@supabase/*` in its own `supabase-*.js` chunk (loaded at startup) so each file stays under the 900 kB size warning.
- Vite reads `planner/.env.production` (Supabase URL and *publishable* key — public by design; deliberately un-ignored in `.gitignore`). `classic/` has its own copy.
- Live Supabase project: `wisner-planner` (ref `axjyhkyvmbrhtivgofya`, us-east-1). Statements containing `drop …` make the Supabase MCP `execute_sql` tool wait for a confirmation that never arrives in a cloud session, so write migrations without DROP or run them from the dashboard.
- Password resets by email need the Supabase Auth Site URL set to https://brianwisner.github.io/Planner/ (Dashboard → Authentication → URL Configuration), which the MCP cannot change.
- The app is installable (`public/manifest.webmanifest`, icons in `public/`).

### Things the owner is likely to ask for

- New fields on jobs/phases/tasks → `setup.sql` (+ migration), `types.ts`, demo defaults/seed, the relevant editor in `editors.tsx`, and wherever it's displayed.
- New phase types → the `kind` check constraint, `add_standard_phases()`, `PHASE_KIND_LABEL`/`PHASE_KIND_SHORT` in `types.ts`, and `lib/stages.ts` if it should be a pipeline stage (plus a `--st-…` color in `tokens.css`).
- Email reminders → would need a scheduled Edge Function (pg_cron + an email provider); currently reminders are browser notifications only. The **Monday morning email** is not app code: it's a Claude scheduled task ("Monday morning planner email", Mondays 6:34 am Pacific) that reads the database read-only, Google Calendar and Gmail, and sends one summary to the owner's business email. If its queries need to change after a schema change, update the scheduled task's prompt.
- Sending invoices by email → the invoice page's Email button opens a pre-filled Gmail message, and Print/Save as PDF makes the attachment; sending without opening Gmail would need the Gmail API or an email provider.
- Two-way Google Calendar → needs Google OAuth (Google Cloud project); current design is a one-way subscription feed.
- **Google sign-in + showing the owner's work Google Calendar** was built once (commit 8df26c9) and then reverted at the owner's request ("connect my work account later"). The live database still has the dormant pieces (`google_tokens`, `private_config`, `settings.allowed_email_domains`, `profiles.google_calendar_ids`, and the `google-calendar` edge function); they are unused.
