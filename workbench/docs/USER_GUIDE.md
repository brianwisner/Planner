# User guide

## Signing in
- **First time only:** open the app URL. You will see *Set up Workbench*. Enter Brian's name, email and a password (10+ characters). That creates the owner account and signs you in.
- **Adding Erika:** Settings → Users → *Add user*. Give her a temporary password; she changes it on Settings → Users → *Change my password* after signing in.
- **Every other time:** the sign-in page asks for email and password. Sessions last 30 days per device.
- **Roles:** Brian (owner) can approve estimates, accept/reject/undo schedule proposals, edit the approved schedule, and manage project types, rates and users. Erika (staff) can do everything else: clients, projects, tasks, time, drafting estimates and proposing schedules.

## On a phone or tablet
Open the app in Safari and use *Share → Add to Home Screen*. It then opens full-screen like an app. Phones show a bottom tab bar (Today, Schedule, Projects, Time, More); tablets and laptops show the side menu.

## Set your working hours (do this first)
Settings → Working hours. Tick the days you work, set start/end and the break, and save. Below that set:
- **Buffer %** – time held back every day for interruptions (10% is a reasonable start).
- **Projects at once** – the recommender tries to keep active projects within this number.
- **Days off & exceptions** – vacations, half days.
Busy all-day events in a connected calendar also block a day.

## Connect Google Calendar and Gmail
Settings → Google. Click *Connect Google Calendar*, approve, then *Refresh list* and tick the calendars that should reduce your availability. Click *Sync now*. The app then syncs automatically when you open it (at most every 15 minutes). Events marked *Free* in Google are ignored.

Optional *write-back*: grant calendar write access, choose a calendar, and use *Publish to Google Calendar* on the Schedule page whenever you want your approved work blocks to appear there as *Free* events. The app ignores its own events when computing availability. Edits you make to those events inside Google are overwritten at the next publish; deleting a block in Workbench deletes its event at the next publish.

Gmail: click *Connect Gmail (read-only)*. The Inbox page then shows recent messages with suggested client/project links. Nothing is sent, deleted, archived or relabeled, ever.

If the server has not been configured with Google credentials yet, the page says so and points to `docs/DEPLOYMENT.md` section 5.

## First client, project and estimate
1. **Clients → New client.** Name, email, phone; add a primary contact if the client is a company.
2. On the client page, **New project.** Pick a *project type* – the template fills in scope, a task list with hours, and a default fee. Set the status (*Inquiry* until the client says yes), priority, and the **client due date** if you have promised one.
3. **New estimate** from the project page. *Import project tasks* brings the template lines in; the right-hand panel shows the template default or, later, similar completed projects with a low/mid/high range, which projects informed it, and how your past estimates compared with actual hours. Adjust lines, pick fixed or hourly, add assumptions and exclusions, then **Save & submit for approval**. Brian approves on the estimate page; *Print / PDF* gives the client-ready summary.
4. When the client accepts, click **Client accepted** on the project (sets the acceptance date). Click **Start work** when you actually begin (sets the actual start). The two dates stay separate.

## Every day
**Today** shows available hours (window − break − appointments − buffer), the ordered work blocks for today with a *Start* button on each, appointments, deadlines and at-risk work, blockers, and anything waiting for Brian's decision. *Start timer* at the top lets you pick any committed project. *Log time* records time by hand.

The timer runs on the server: close the tab, switch to your phone, lose Wi-Fi – it keeps counting from the moment you pressed start, and you can stop it from any device. Starting a new timer stops the previous one; there is never more than one running per person.

## Scheduling
- **Recommend schedule** (anyone) builds a proposal from remaining hours, priorities, deadlines, dependencies, blockers, your hours and your "projects at once" limit. The proposal page lists *what would change and why*, completion forecasts versus client due dates, and warnings. Brian can adjust hours and **Accept and apply** or **Reject**. Nothing changes until he accepts. *Undo* (Schedule → Proposals) reverses the last accepted proposal.
- **Manual changes** (owner): *+ Add work* on any day, click a block to edit, lock, move it a day, or remove it; drag blocks between days on a desktop. If a change overbooks a day or lands on a day off, the app explains the consequence and asks you to confirm. It never moves other work on its own.
- **Lock** a block and later recommendations keep it exactly where it is. *Fixed commitments* (site visits, jury duty) are always locked.
- **Tentative capacity:** inquiries and proposals stay out of the workload unless you tick *Reserve tentative capacity* on the project and *include tentative* when recommending.
- **What-if** lets you change priorities, remaining hours, due dates and capacity in a sandbox and compare forecasts against the current plan. Turning a scenario into a proposal still requires Brian's acceptance.
- **Forecast vs commitment:** the *forecast* is simply the last scheduled day for a project; the *client due date* is what you promised. The app flags a project *at risk* when the forecast is later than the promise.

## Remaining effort
Hours spent are not progress. On a project, *Update remaining* sets your own estimate of hours still needed; until you do, remaining = estimate − logged. Tasks carry their own estimated/remaining hours too.

## Reports
Workload vs capacity (next 8 weeks), estimated vs actual vs remaining per project, approaching deadlines with forecasts, estimating accuracy by project type (fills in as projects complete), and time this month.

## Data, export, backup
Settings → Data: CSV exports of clients, projects, time, estimates and a complete JSON export. Backup instructions are in `docs/DEPLOYMENT.md`.

## Working offline and on several devices
- Each save shows **Saving… / Saved / Not saved**. If you are offline a yellow banner appears; pages you opened recently still display, but **nothing is saved to the server until you are back online** – the app will tell you the change was not saved rather than pretend.
- If two people edit the same record, the second save is refused with a message to reload the latest version. Nothing is silently overwritten.
- Timers are unaffected by connectivity because the start time lives on the server.

## History
Every approval, schedule change, and edit to important records is recorded with who and when: on each client/project/estimate page and under Settings → History.
