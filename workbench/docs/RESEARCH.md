# Research summary and design decisions

**How this research was done.** A research pass looked at 20 products (Monday.com, Asana, ClickUp, Notion, Trello/Planyway, Motion, Reclaim, Float, Resource Guru, Teamwork, Productive, Scoro, Harvest, Toggl Track, Clockify, Everhour, BQE Core, Sunsama, Akiflow, Moxie/Bonsai). **Limitation to disclose:** the build environment could not open web pages directly (page fetches were blocked), so every "verified" claim rests on search-result excerpts of the vendors' official help pages or credible reviews, each cited by URL in `RESEARCH-NOTES.md`. Claims that could not be checked are marked as assumptions there. Notion, Trello, Hubstaff, Deltek and HoneyBook were not verified at all.

## What matters for a two-person structural practice

The firm's problems are: knowing what to work on today, not overcommitting weeks, estimating from real history, and capturing time without ceremony. Most products above are built for teams of 10–500 and spend most of their surface on collaboration, permissions, billing and dashboards. The useful parts are a handful of interaction patterns.

## Comparison: adopt, adapt, leave out

| Pattern | Seen in | Adopted in Workbench? | Why it helps Brian and Erika |
|---|---|---|---|
| Calendar busy time sets the capacity ceiling | Motion, Reclaim | **Yes.** Working hours − breaks − busy Google Calendar events − buffer = available hours per day. Overlapping events are merged, "Free" events ignored, all-day busy events block the day. | Prevents overbooking without typing availability by hand. |
| Internal work blocks written back as *Free* events, tagged so they are never double-counted | Reclaim | **Yes** (optional write-back). | Brian still looks available for client meetings; the app ignores its own events. |
| Lock on manual move; recommendations only rearrange unlocked work | Motion, Reclaim | **Yes.** Any block can be locked; fixed commitments are always locked. | Preserves human decisions across re-planning. |
| Confirmed vs tentative allocations; tentative excluded from committed load | Float, Productive | **Yes.** Inquiries and proposals stay out of the workload unless "reserve tentative capacity" is ticked; recommendations can include tentative work on request. | Honest capacity picture; opportunities stay visible. |
| Clash dialog instead of silent overbooking | Resource Guru | **Yes.** Manual adds/moves that overbook a day or land on a day off return a warning; the owner must confirm; other work is never moved automatically. | No hidden overload. |
| Daily "what to work on" with planned-vs-available warning | Sunsama, Asana, ClickUp | **Yes.** Today view shows ordered work blocks, appointments, available hours, at-risk deadlines, blockers and approvals. | Clear daily decisions. |
| Estimate vs planned vs actual vs *explicit* remaining | Scoro, BQE Core, Teamwork, Everhour | **Yes.** Remaining effort is its own field (derived until you override it); reports show estimated / actual / remaining and accuracy by project type. | Hours spent ≠ progress. |
| Progress past 100%, alerts instead of hard stops | Clockify, Everhour | **Yes.** Time entry is never blocked; overruns are shown in red. | Data stays honest. |
| One running timer per person, server-side, start/stop from any device | Harvest, Toggl | **Yes.** Enforced by a database unique index; starting a new timer stops the old one; elapsed time is computed from the server timestamp. | Accurate across tabs, devices and restarts. |
| Templates with default phases, hours and fee | ClickUp, Scoro | **Yes.** Project types are templates; new projects get scope, tasks, hours and fee; estimates can import the task list. | Less repeated data entry; comparable history. |
| Quoted vs actual per line; revisions kept | Scoro | **Yes.** Estimates have revisions; approved ones are frozen; original vs added scope are separate. | Better future estimates. |
| Personal triage sections (Today/Upcoming/Later) | Asana | **Adapted.** Instead of task sections, the schedule itself is the triage; deadlines in the next 14 days and at-risk work are listed on Today. | Same effect with less maintenance. |
| Command-bar quick capture | Akiflow | **Partly.** Quick "Start timer" and "Log time" from Today; tasks are added inline on the project. | Keeps it simple. |
| Gantt, dependencies with critical path | Monday, ClickUp, Teamwork | **Left out** (simple project-level and task-level dependencies only). | Two people do not need a Gantt chart. |
| Chat, comments, @mentions, notification feeds | Most | **Left out.** | Noise for two people in one office. |
| Timesheet approvals, roles/departments matrices | BQE, Harvest | **Left out.** Two roles only (owner, staff), enforced on the server. | Enough control with no ceremony. |
| Invoicing, expenses, payroll, accounting sync, client portal | Harvest, Productive, Scoro, BQE, Bonsai | **Left out by decision.** Core records export to CSV/JSON. | Out of scope; data stays portable. |
| Opaque AI auto-scheduling | Motion | **Replaced** by a deterministic, explainable recommender: every proposal lists what moves and why. | You can trust and audit it. |
| Spreading hours evenly across a date range | monday.com | **Left out.** Blocks are explicit hours per day. | Avoids false overloads. |

## Technology choice (brief)

- **Next.js 16 + TypeScript** for one codebase serving the web app and its API; it runs on any Node host and has a well-trodden deployment path.
- **PostgreSQL** with **Drizzle** migrations: a real shared database, cheap managed options, trivial backups with `pg_dump`.
- **Session cookies + bcrypt passwords** (no third-party auth dependency); Google is connected per user with OAuth and encrypted refresh tokens.
- **Tailwind CSS** for a calm, consistent, responsive interface; **Recharts** for the few charts that earn their place.
- **Vitest** for the scheduling, capacity, estimating and email-matching engines; **Playwright** for the critical workflows at desktop, iPhone and iPad sizes.
- **Progressive web app** shell (installable; read-only offline for recently opened pages).
