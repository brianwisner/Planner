# Product research: planning, scheduling, estimating, time tracking and client records for a two-person engineering practice

Scope: Wisner Engineering, LLC (Brian + Erika). Custom internal app covering project planning, scheduling/capacity, estimates, time tracking, client records, reports. Out of scope: invoicing, accounting, payroll, client portal.

Method note: direct page fetches (WebFetch and curl) were blocked by the sandbox for every host, so all VERIFIED claims below come from search-result excerpts of official help/product pages or credible reviews, with the source URL cited. Anything labeled ASSUMPTION is from memory and was not confirmed. Sources are listed in the References section.

Legend: [V] = verified against the cited source; [A] = assumption from memory.

## Per-product notes

### Motion (usemotion.com)
AI task manager/calendar that auto-schedules tasks into free calendar time.
- [V] Auto-scheduling weighs open time, task duration, deadlines, priorities, and new events/changes; tasks are placed around events on the main and "My Calendars" (treated as fixed), while "Frequently Met With" calendars are visible but ignored for scheduling. (Motion help: Concept: Auto-scheduling; Detailed Guide to Calendars)
- [V] Travel-time buffers before/after events and recurring breaks between tasks. (Motion help)
- [V] When the day changes, tasks are reshuffled automatically; manually moving a task block locks it (lock icon) so it is not repositioned again. (Motion help + Upbase review)
- [V] Tasks can appear only in Motion or also be synced to Google/Outlook. (Motion help)
- [A] Project templates and task "chunking" of long tasks into sessions.

### Reclaim.ai
AI calendar assistant for Google Calendar; tasks, habits, focus time.
- [V] Tasks are placed around existing events, ordered by priority and ahead of due dates; large tasks are split into work sessions; auto-rescheduling on conflict. (reclaim.ai/features/tasks)
- [V] Blocks can be "free" or "busy" so they protect time without killing availability; tentative blocks are held, and the AI locks tasks in as deadlines approach. (reclaim.ai/features/tasks)
- [V] Focus Time has a weekly goal; Proactive mode fills early, Reactive mode blocks only when meetings threaten the goal; a manually moved block gets locked; a displaced block moves to the "next best slot". (ZoomInfo review of Reclaim)
- [A] Min/max chunk duration per task and "scheduling hours" windows per task type.

### Float
Resource scheduling/capacity tool with people-by-week timeline.
- [V] New allocations default to confirmed (solid tile); each allocation can be switched to tentative (outline only) or completed (checkmark). (support.float.com "Add an allocation")
- [V] Tentative status inherits from a tentative project or phase; an allocation inside a confirmed project can still be marked tentative; confirmed phases cannot be added to tentative projects. (support.float.com; float.com what's-new)
- [V] Placeholders: schedule future work tentatively, flip to confirmed when the project kicks off. (float.com what's-new Placeholders)
- [A] Time-off and public holidays reduce capacity; logged time can be compared to scheduled time.

### Resource Guru
Bookings-based scheduling with clash prevention.
- [V] Clash management: when a person lacks availability, the booking cannot simply overlap; options are add to the Waiting List, add with overtime, or extend availability without overtime. (help.resourceguruapp.com Booking Clashes article)
- [V] Waiting List bookings are unconfirmed, shown with diagonal lines on red; they signal "move it, reassign it, or shorten it". (same)
- [V] "Total hours" bookings are fitted into available time and any overflow goes straight to the Waiting List; the Availability Bar shows remaining free time, overtime and waiting-list hours per person. (same)

### Harvest
Time tracking and timesheets for small service firms.
- [V] Harvest auto-stops other running timers for the same user only on the same day; a timer left running on an earlier day keeps running (often started by an integration/API) and must be stopped from the owner's account via the running-timer indicator. (support.getharvest.com "Stopping a stuck or runaway timer")
- [V] If connectivity drops the timer keeps running; you can stop/edit when back online. (support.getharvest.com "Can I use Harvest offline?")
- [V] Invoicing/approval/archiving is blocked while a timer is running on the affected entries. (support.getharvest.com article 360048687651)
- [V] Idle-time detection in Mac/Windows apps. (support.getharvest.com 360048685231)
- [A] Project budgets in hours or fees with % alerts; timesheet reminders; weekly timesheet grid plus day view.

### Toggl Track
Lightweight timer-first time tracking.
- [V] Offline tracking on mobile; entries sync when back online; a timer started in the browser can be stopped on the phone; settings sync across devices. (toggl.com product hub; app store/release notes)
- [A] One running entry per user; starting a new one stops the previous; project time estimates with alerts; calendar integration shows events alongside entries for "fill in your day".

### Clockify
Free/cheap timer, timesheet and reporting.
- [V] Two estimate types: time estimate (hours expected, based on tracked entries) and budget estimate; it never blocks tracking once an estimate is used up, and progress bars run past 100%; workaround is alerts or archiving the project. (clockify.me/help "Understanding project estimates")
- [A] Timesheet grid, approvals, idle detection, scheduling module.

### Everhour
Time tracking embedded in task tools (Asana, ClickUp, Linear, etc.).
- [V] Admin-configurable budget alert thresholds (e.g. 75/90/100%); budget protection can stop timers after the cap; reports show tracked, estimated, remaining and over-estimate time; alerts are driven by logged time, not estimates. (everhour.com integration pages)

### ClickUp
All-in-one work management.
- [V] Workload view can show capacity by Time Estimates; per-person daily availability is editable; bars shift green/orange/red as load approaches or exceeds capacity; subtask estimates roll up to the parent. (help.clickup.com 7257011414807; processdriven.co; ClickUp blog)
- [A] Time estimates vs tracked time shown side by side on tasks; per-assignee estimates on higher plans.

### Asana
Task/project tool with a strong personal "My Tasks" view.
- [V] My Tasks has Recently Assigned, Today, Upcoming and Later; tasks auto-promote to Upcoming one week out and to Today one day out, by due date or start date; tasks without dates stay in Later; sorting by due date removes the sections. (asana.com "Four ways to master My Tasks"; forum.asana.com)
- [A] Workload view with effort field and capacity; rules/automations; project templates.

### monday.com
Board-based work OS.
- [V] Workload widget: capacity from each user's "Work schedule" by default, or "Custom" units (e.g. points); overallocation is flagged visually and rebalanced by drag and drop. (support.monday.com 360010699760; monday.com capacity page)
- [V] Known quirk: hours are spread evenly across a task's date range, so a short task can show overload. (community.monday.com)
- [V, third-party] Overallocation alerts and a "prevent overallocation" option reportedly exist on Pro+. (temperstack.com - unverified against official docs)

### Teamwork.com
Client-work project management.
- [V] Estimated time = predicted time to complete a task; logged time = cumulative logged; "Estimated vs logged time" report per task; "Utilization" report = estimated load as share of available time. (support.teamwork.com "Estimated time on tasks")
- [V] Has a "tentative work" concept (support.teamwork.com tentative-work-overview page exists; details not fetched).

### Productive.io
Agency operations platform (budgets, resourcing, time, profitability).
- [V] Budget forecasting charts combine past data with scheduled bookings to project when a budget runs out; bookings must be added in the Resource Planner first; chart enabled per budget via Overview > Show forecast chart. (help.productive.io 4611165)
- [V] Budget burn and profitability tracked in real time; custom alerts for overruns; fixed-price, hourly, retainer and mixed budgets. (productive.io/budgeting; productive.io blog)
- [V] Tentative bookings exist ("soft allocations" that do not count toward scheduled hours until confirmed). (help.productive.io 8582323, from search excerpt)

### Scoro
Quote-to-cash work management.
- [V] Quoted vs Actual table in the Budget section: every quoted line vs actual results, income to date = logged time x selling rate. (support.scoro.com 13750171945101)
- [V] Burn-up chart with four lines: budget (total hours budgeted), planned (duration of assigned tasks/events), actual (time spent), forecast (remaining); currently tracks only the time budget. (scoro.com version update 23-08; support.scoro.com)

### BQE Core
Practice management for A/E firms (replaces ArchiOffice/EngineerOffice/BillQuick).
- [V] Budgets per project and phase; hours tracked on a phase against its budget; Budgets Comparison report shows actual vs budget; approved and unapproved time both count against budgets; Project Status widget uses red circles for projects/phases over budget; no notification on exceeding budget. (corehelpcenter.bqe.com 360063375493, 4423190509079, 4402832133911; blog.bqe.com)
- [V] Timers for real-time tracking on multiple projects. (corehelpcenter.bqe.com 4402832133911)
- [A] Contacts/clients tied to projects; per-user pricing that is heavy for 2 people.

### Sunsama
Daily planning ritual app.
- [V] Each task has a planned time; the day's planned total is compared to a workload threshold set in settings and a warning appears when over; timeline shows estimated finish vs preferred shutdown time. (help.sunsama.com Daily Planning; reviews)
- [V] Task timer records actual time; no flag when the timer passes planned time (roadmap request); shutdown prompts review and moving unfinished tasks to tomorrow/later; keys D (defer) and Z (backlog). (help.sunsama.com; roadmap.sunsama.com)

### Akiflow
Command-bar task + calendar time-blocking tool.
- [V] Universal Inbox pulls tasks from email, Slack, Notion, Asana, etc.; manual drag-to-calendar time blocking; recurring "Time Slots" (containers for deep work/admin) so tasks are not pinned to exact times; guided morning plan and end-of-day shutdown. (morgen.so and dhruvirzala.com reviews)

### Moxie / Bonsai (freelancer back-office)
- [V] Both bundle proposals, contracts, CRM, time tracking; neither offers real project management; both need manual time-to-invoice steps. (agiled.app, millo.co, plutio.com comparisons)
- Relevance: client/contact records and a simple pipeline (lead > proposal > active > closed) are the only transferable ideas.

### Not verified (search budget): Notion, Trello/Planyway, Hubstaff, Deltek, HoneyBook
- [A] Notion: flexible databases, relations/rollups (e.g. project rollup of task hours) but no native timer or capacity model. [A] Trello + Planyway: calendar/timeline on cards, light time tracking. [A] Hubstaff: employee monitoring focus, not a fit. [A] Deltek Vantagepoint/Ajera: full A/E ERP with earned-value style reporting; far too heavy. [A] HoneyBook: client pipeline/booking for creatives.

## Synthesis

### 1. Comparison table

| Product | Does well for a 2-person firm | Notable interaction patterns | Leave out and why |
|---|---|---|---|
| Motion | Turns a task list into a daily plan automatically | Calendar busy = fixed; tasks fill gaps; manual move locks a block; buffers | Full AI rescheduling engine (complex, opaque); meeting booking pages |
| Reclaim | Protects work time without hiding availability | Free/busy flag on blocks; lock near deadline; "next best slot" on displacement | Habits/Smart meetings; multi-user team analytics |
| Float | Capacity picture by week | Confirmed vs tentative vs completed tiles; inheritance from project/phase | Multi-team views, roles/departments |
| Resource Guru | Hard overbooking prevention | Clash dialog: waiting list / overtime / extend availability; availability bar | Equipment/room booking, approvals |
| Harvest | Friction-free timers and timesheets | One live timer per day; runaway-timer handling; blocks approval while timer runs | Invoicing, expenses, payments |
| Toggl Track | Timer-first UX | Start anywhere, stop anywhere; offline entries sync later | Team dashboards, Toggl Plan |
| Clockify | Simple estimates | Progress bar past 100%, never blocks tracking | Kiosk, GPS, approvals |
| Everhour | Budget alerts | Threshold alerts at N%; optional hard stop | Deep third-party integrations |
| ClickUp | Workload by time estimate | Editable daily capacity; green/orange/red bars; subtask roll-up | Everything else (docs, chat, whiteboards, Gantt) |
| Asana | Personal triage | Today/Upcoming/Later with auto-promotion by date | Portfolios, workload admin, rules |
| monday.com | Visual capacity | Capacity from work schedule; prevent-overallocation toggle | Boards/automations sprawl; even-spread quirk |
| Teamwork | Estimate vs logged reports | Utilization = estimated load / available time | Client portal, billing, chat |
| Productive | Budget burn + forecast | Forecast from scheduled bookings; soft allocations excluded until confirmed | Sales pipeline, invoicing, payroll |
| Scoro | Quote-to-project tracking | Quoted vs actual per line; burn-up with budget/planned/actual/forecast | Full ERP, CRM, finance |
| BQE Core | A/E phase budgets | Phase-level budget vs actual; unapproved time counts; red over-budget markers | Billing, accounting, per-seat pricing |
| Sunsama | Honest daily plan | Planned-time sum vs daily threshold; shutdown ritual; rollover | Channel integrations, weekly objectives |
| Akiflow | Fast capture | Command bar; universal inbox; recurring time slots | Integrations marketplace |
| Moxie/Bonsai | Client pipeline | Lead > proposal > active status | Contracts, invoicing, portal |

### 2. Patterns to ADOPT

1. **Calendar busy time is the capacity ceiling (Motion, Reclaim).** Pull Google/Outlook events; treat them as fixed; available hours per day = working hours minus events minus time off. Prevents overbooking without anyone entering availability by hand. Reclaim's free/busy flag per block is worth copying so internal work blocks do not hide real availability.
2. **Today / Upcoming / Later triage with auto-promotion (Asana).** A personal "what to work on" list that promotes items by start/due date (one week out, one day out) and keeps undated items in Later. Clarifies priorities with zero daily admin.
3. **Planned-time sum vs daily threshold (Sunsama) and green/orange/red capacity bars (ClickUp, monday).** Sum of planned hours for the day vs available hours; warn when over. Immediate feedback that prevents overcommitting a day; end-of-day prompt to roll unfinished items forward.
4. **Confirmed / tentative / completed on allocations, inherited from project status (Float, Productive).** Lets Brian pencil in proposals that may not land; tentative hours are shown but excluded from committed load (Productive's soft allocation rule). Improves the capacity forecast and estimate hit-rate review.
5. **Clash dialog instead of silent overbooking (Resource Guru).** When an allocation exceeds remaining hours, force a choice: shorten, move, mark as overtime, or park in a waiting list. Prevents hidden overload.
6. **Estimate vs planned vs actual vs remaining per phase (Scoro burn-up, BQE phase budgets, Teamwork reports, Everhour).** Each project phase carries budgeted hours; actual = logged hours; remaining is an explicit field the engineer can override (not just budget minus actual). Gives honest estimates-to-complete and a history for better future estimates.
7. **One running timer per person; start anywhere, stop anywhere; runaway detection (Harvest, Toggl).** Starting a new timer stops the old one; a timer still running from a previous day is flagged on next open; entries editable after the fact. Cuts admin and bad data.
8. **Progress bars that go past 100% and threshold alerts rather than hard stops (Clockify, Everhour).** Overruns stay visible; tracking never blocked.
9. **Templates for project phases and tasks with default hour estimates (ClickUp subtask roll-ups, Scoro quoted lines).** New residential/commercial project = pick template, adjust hours. Speeds estimating and makes estimate vs actual comparable across projects.
10. **Lock on manual move (Motion, Reclaim).** If an auto-suggested slot is dragged, it stays put; auto-planning only rearranges unlocked work.
11. **Quick capture / command bar (Akiflow).** One keystroke to add a task with project, estimate and date.

### 3. Patterns to LEAVE OUT

- Gantt charts, dependencies and critical path: two people do not need them; a phase list with dates and a weekly capacity grid is enough.
- Chat, comments threads, @mentions, notifications feeds: email and in-person suffice; adds noise.
- Enterprise permission matrices, roles, departments, approval workflows for timesheets (BQE/Harvest approvals): owner and assistant share everything; a simple "locked period" after reporting is sufficient.
- Invoicing, expenses, payments, payroll, accounting sync: out of scope by decision; keep hours exportable instead.
- Client portals, proposals e-signature, contracts (Moxie/Bonsai/HoneyBook).
- Full AI auto-scheduling engine (Motion): opaque and over-engineered; a deterministic "suggest next free slot" with lock is enough.
- Even-spread of hours across a date range (monday quirk): allocate by explicit hours per day/week instead.
- Hard budget stops (Everhour): never block time entry.
- Story points / custom effort units: hours only.
- Utilization percentages and billable-rate profitability dashboards (Productive/Scoro): useful later, not for v1.

### 4. Behaviors worth copying in detail

- **Busy time (Motion/Reclaim):** events on the owner's primary calendars are immovable; internal work blocks are written back as "free" so Brian still appears available; blocks auto-lock when manually moved or within ~1 day of deadline; displaced blocks move to the next best slot, never dropped silently.
- **Tentative vs confirmed (Float/Productive):** default new allocation = confirmed; tentative is drawn as outline; a tentative project makes all its allocations tentative; tentative hours appear in the grid but are excluded from committed load and from overbooking warnings (shown separately as "if won").
- **Clash handling (Resource Guru):** total-hours bookings fit into free time; overflow goes to a waiting list with red hatching; the availability bar shows free, overtime and waiting hours.
- **Timers (Harvest/Toggl):** one running entry per user; starting another stops the first (same day); timer state lives server-side so any device can stop it; if a timer is older than today, show a "runaway timer" banner with stop-and-edit; offline edits sync later; a running timer blocks period locking.
- **Budget vs actual (Scoro/BQE/Teamwork):** per phase store budget hours, planned (scheduled) hours, actual (logged) hours, forecast remaining; show burn-up lines; count unapproved/unreviewed time immediately; red marker when actual > budget; no notification needed beyond the dashboard marker and a threshold alert at 75/90/100%.
- **Daily plan (Sunsama/Asana):** auto-promote by date; sum planned minutes vs daily threshold; shutdown step asks what to do with unfinished items (defer to tomorrow, backlog, mark done); record planned vs actual per task to feed estimate accuracy reports.

## References
- Motion help, Concept: Auto-scheduling: https://www.usemotion.com/help/time-management/auto-scheduling/concept-auto-scheduling
- Motion help, Detailed guide to calendars: https://help.usemotion.com/product-and-feature-guides/calendar/events/detailed-guide-to-calendars-in-motion
- Motion review (Upbase): https://upbase.io/blog/motion-app-review/
- Reclaim Tasks: https://reclaim.ai/features/tasks
- Reclaim review (ZoomInfo): https://pipeline.zoominfo.com/sales/reclaim-ai-review
- Float, Add an allocation: https://support.float.com/en/articles/4188692-allocate-time
- Float, Placeholders: https://www.float.com/whats-new/plan-ahead-with-placeholders
- Float, project plan and time off enhancements: https://www.float.com/whats-new/project-plan-and-time-off-get-a-few-delightful-enhancements
- Productive, Tentative bookings: https://help.productive.io/en/articles/8582323-tentative-bookings
- Productive, Forecasting charts on budgets: https://help.productive.io/en/articles/4611165-forecasting-profitability-charts-on-budgets
- Productive budgeting: https://productive.io/budgeting
- Resource Guru, Booking clashes, waiting list, overtime: https://help.resourceguruapp.com/en/articles/2942080-booking-clashes-the-waiting-list-overtime-and-capacity-planning
- Resource Guru, extending availability: https://resourceguruapp.com/blog/extending-availability-and-more
- Harvest, Stopping a stuck or runaway timer: https://support.getharvest.com/hc/en-us/articles/47201092522509-Stopping-a-stuck-or-runaway-timer
- Harvest, offline use: https://support.getharvest.com/hc/en-us/articles/360052219232-Can-I-use-Harvest-offline
- Harvest, running timer blocks invoice/approve/archive: https://support.getharvest.com/hc/en-us/articles/360048687651-Why-can-t-I-invoice-approve-or-archive-items-when-a-timer-is-running
- Harvest, idle timer: https://support.getharvest.com/hc/en-us/articles/360048685231
- Harvest multi-device: https://www.getharvest.com/it/time-tracking/multi-device-time-tracker
- Toggl Track, time tracking anywhere: https://toggl.com/product-hub/time-tracking-anywhere
- Clockify, Understanding project estimates: https://clockify.me/help/troubleshooting/project-issues/understanding-project-estimates
- Everhour, ClickUp estimate vs actual: https://everhour.com/integrations/clickup-estimate-vs-actual
- Everhour, Linear budget warning: https://everhour.com/integrations/linear-budget-warning
- ClickUp, time estimates in views: https://help.clickup.com/hc/en-us/articles/7257011414807
- ClickUp workload (ProcessDriven): https://processdriven.co/clickup/advanced-clickup/clickup-workload-view
- ClickUp blog, workload views: https://clickup.com/blog/clickup-workload-views-team-capacity/
- Asana, Four ways to master My Tasks: https://asana.com/sv/resources/asana-tips-my-tasks
- Asana forum on Today/Upcoming/Later: https://forum.asana.com/t/i-cannot-see-the-today-upcoming-and-later-sections/19477
- monday.com workload support: https://support.monday.com/hc/en-us/articles/360010699760
- monday.com community, even-spread quirk: https://community.monday.com/t/workload-view-option-to-distribute-work-based-on-capacity/75116
- monday capacity limits (third party): https://www.temperstack.com/learn/monday/set-workload-capacity-limits/
- Teamwork, Estimated time on tasks: https://support.teamwork.com/projects/time/estimated-time-on-tasks
- Teamwork, tentative work overview: https://support.teamwork.com/projects/planning-managing-work/tentative-work-overview
- Scoro, version update 23.08 (burn-up chart): https://www.scoro.com/blog/scoro-version-update-23-08
- Scoro, Step 8 Track project progress: https://support.scoro.com/hc/en-us/articles/13750171945101-Step-8-Track-project-progress-and-results
- BQE Core, track time on phases: https://corehelpcenter.bqe.com/hc/en-us/articles/360063375493-How-can-I-track-time-on-project-phases
- BQE Core, unapproved time against budgets: https://corehelpcenter.bqe.com/hc/en-us/articles/4423190509079-Tracking-unapproved-time-against-budgets
- BQE Core, features: https://corehelpcenter.bqe.com/hc/en-us/articles/4402832133911
- BQE blog, budgets: https://blog.bqe.com/core/maximize-your-project-analysis-and-profits-with-budgets-in-bqe-core
- Sunsama, Daily Planning: https://help.sunsama.com/docs/usage-guides/daily-planning
- Sunsama roadmap, actual vs planned: https://roadmap.sunsama.com/improvements/p/make-completed-tasks-on-the-calendar-reflect-actual-time-rather-than-planned-tim
- Sunsama review (Asian Efficiency): https://www.asianefficiency.com/schedule-management/sunsama-review/
- Akiflow review (Morgen): https://www.morgen.so/blog-posts/akiflow-review
- Akiflow review: https://dhruvirzala.com/akiflow-review/
- Bonsai vs Moxie (Agiled): https://agiled.app/compare/bonsai-vs-moxie
- Hello Bonsai review (DPM): https://thedigitalprojectmanager.com/tools/hello-bonsai-review/
- Engineering PM tools roundup (BigTime, vendor): https://www.bigtime.net/blogs/best-engineering-project-management-software/
- Engineering time tracking roundup (Monograph, vendor): https://monograph.com/blog/best-time-tracking-software-for-engineers
