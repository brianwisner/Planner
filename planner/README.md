# Wisner Engineering Project Planner

A project planning app for a small structural engineering firm. It runs in any browser (desktop, laptop, iPhone, iPad), everyone on the team sees the same live data, and it is free to run.

![Dashboard](docs/screenshots/dashboard.png)

## What it does

- **Clients → Jobs → Phases → Tasks.** Every job automatically gets the four phases: Original design, County / plan-check comments, Construction changes, Client-requested changes. Each phase has its own hour estimate, start and due dates, status and assignee.
- **Jobs page with four views:** a prioritized **Table** (drag the ≡ handle to reorder the queue), a **Board** (drag task cards between To do / In progress / Waiting / Done), a **Gantt** timeline for long-range planning, and a **Calendar**.
- **Dashboard:** team workload, how far out each person is booked, overdue items, what's due this week, your open tasks.
- **Time tracking:** start/stop timer or type hours against a job, phase and task. Timesheet by week. Actual vs. estimate on every phase.
- **Billing:** per job, see unbilled hours (× hourly rate), invoiced, paid and outstanding. Select hours → record an invoice → they're marked billed.
- **Reports:** hours by job, client and person; estimate vs. actual; all exportable to CSV.
- **Google Calendar:** a private calendar feed that Google Calendar subscribes to, plus "Download .ics" and per-item "Add to Google Calendar" links.
- **Also:** notes on each job, global search (press `/`), filters, due-date reminders, recurring tasks, quick-add (press `n`), keyboard shortcuts (press `?`), CSV export.

| Jobs table | Board | Gantt |
|---|---|---|
| ![](docs/screenshots/jobs-table.png) | ![](docs/screenshots/board.png) | ![](docs/screenshots/gantt.png) |

| Job detail | Billing | Phone |
|---|---|---|
| ![](docs/screenshots/job-detail.png) | ![](docs/screenshots/billing.png) | ![](docs/screenshots/phone-dashboard.png) |

## How it's built (plain English)

- **The app itself** is a website made with React. It is hosted for free on **GitHub Pages**, straight from this repository. Every time code is pushed to the main branch, GitHub rebuilds and republishes it automatically (see `.github/workflows/deploy.yml`).
- **The data** (clients, jobs, hours, invoices…) lives in **Supabase**, a hosted database with built-in logins and live syncing. The free plan is plenty for a small team.
- **Logins** are email + password. You create staff accounts from the Supabase dashboard (invite by email).
- Your web address will be: **https://brianwisner.github.io/Who-knows/**

The website files are public (anyone could view the code), but all of your data sits behind the login and is only visible to signed-in team members.

---

## Setup — one-time, about 20 minutes

You need: a GitHub account (you have one) and a free Supabase account (step 1).

### Step 1 — Create the database (Supabase)

1. Go to **https://supabase.com** and click **Start your project**. Sign in with your GitHub account (easiest).
2. Click **New project**.
   - Organization: leave the default.
   - Name: `wisner-planner`
   - Database password: click **Generate a password**, then copy it somewhere safe (you will rarely need it, but keep it).
   - Region: pick the one closest to you (for example *West US*).
   - Plan: **Free**.
3. Click **Create new project** and wait about 2 minutes until the project page says it's ready.

### Step 2 — Build the tables and add sample data

1. In the left sidebar, click **SQL Editor** (the icon looks like `>_`).
2. Click **New query** (or the **+** tab).
3. Open the file `planner/supabase/setup.sql` from this repository in GitHub, click the **copy** icon at the top-right of the file (two overlapping squares), go back to Supabase and **paste** everything into the big editor box.
4. Click **Run** (bottom right, or press Ctrl/Cmd+Enter). After a few seconds it should say **Success. No rows returned**.

That created all the tables, the security rules, live-sync, and three sample clients with jobs.

### Step 3 — Tell Supabase where the app lives

1. Left sidebar → **Authentication** → **URL Configuration**.
2. **Site URL**: `https://brianwisner.github.io/Who-knows/`
3. Under **Redirect URLs**, click **Add URL** and enter `https://brianwisner.github.io/Who-knows/**` (with the two stars).
4. Click **Save**.

This makes the "accept invitation" and "reset password" emails send people to the right place.

### Step 4 — Create your own login

1. Left sidebar → **Authentication** → **Users**.
2. Click **Add user** → **Create new user**.
3. Enter your email and a password you'll remember. Tick **Auto Confirm User**. Click **Create user**.

The first account created gets the sample jobs assigned to it, so your dashboard has something to show.

### Step 5 — Copy the two connection values into GitHub

1. In Supabase, click the **gear icon (Project Settings)** at the bottom of the left sidebar, then **API Keys** (on some projects it's called **API**).
2. You need two things:
   - **Project URL** — looks like `https://abcdefghijkl.supabase.co`
   - **Publishable key** (older projects call it the **anon public** key) — a long string starting with `sb_publishable_` or `eyJ…`
3. Now open your repository on GitHub: **https://github.com/brianwisner/Who-knows**
4. Click **Settings** (top tab) → in the left list, **Secrets and variables** → **Actions** → click the **Variables** tab.
5. Click **New repository variable**. Name: `VITE_SUPABASE_URL`  Value: paste the Project URL. Click **Add variable**.
6. Click **New repository variable** again. Name: `VITE_SUPABASE_ANON_KEY`  Value: paste the key. Click **Add variable**.

### Step 6 — Turn on the free website hosting

1. Still in the repository **Settings**, click **Pages** in the left list.
2. Under **Build and deployment → Source**, choose **GitHub Actions**. (That's it, nothing else to click.)

### Step 7 — Publish

1. Go to the repository's **Pull requests** tab and open the pull request named *"Add project planner web app"*.
2. Click **Ready for review**, then **Merge pull request**, then **Confirm merge**.
3. Click the **Actions** tab. You'll see *"Deploy planner to GitHub Pages"* running. Wait until it shows a green check (about 2 minutes).
4. Open **https://brianwisner.github.io/Who-knows/** and sign in with the email and password from Step 4.

If you ever change the two variables from Step 5, go to **Actions → Deploy planner to GitHub Pages → Run workflow** to republish.

### Step 8 — Put it on your phone and iPad

- **iPhone / iPad:** open the address in Safari, tap the **Share** button, then **Add to Home Screen**. It then opens full-screen like an app.
- **Android:** open in Chrome → menu (⋮) → **Add to Home screen**.
- **Desktop:** just bookmark it. In Chrome you can also click the install icon in the address bar.

### Step 9 — Add your staff

1. Supabase → **Authentication** → **Users** → **Add user** → **Send invitation**. Enter their email.
2. They get an email with an **Accept the invite** link. It opens the app and asks them to choose a password and enter their name.
3. That's it; they see all the same jobs. Each person can set their hourly rate and weekly capacity under **Settings**.

### Step 10 (optional) — Google Calendar sync

The calendar feed needs a tiny piece of server code running inside Supabase. One-time setup:

1. Supabase → left sidebar **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Function name: `ics`
3. Delete the example code in the editor and paste the entire contents of `planner/supabase/functions/ics/index.ts` from this repository.
4. Click **Deploy function**.
5. Open the `ics` function → **Details** (or **Settings**) tab → turn **off** the option called **Verify JWT with legacy secret** (or **Enforce JWT verification**) → Save. This lets Google Calendar fetch the feed without a login; the long random token in each person's link is what keeps it private.
6. In the app, go to **Settings → Google Calendar sync**, click **Copy link**, then click the Google Calendar button and paste the link into **URL of calendar** → **Add calendar**.

Deadlines and site visits now show up in Google Calendar on every device. Google refreshes subscribed calendars every few hours. The feed includes everyone's items; add `&mine=1` to the end of the link for only your own.

Until you do this step, the **Calendar** page's **Download .ics** button and the per-item **Add to Google Calendar** links work with no setup at all.

---

## Everyday use

- **Start a job:** Jobs → **New job**. Pick the client, give it a name, optional fee and due date. The four phases are created for you. Then open the job and fill in each phase's estimate, dates and who's doing it.
- **Prioritize:** on the Jobs table, drag the **≡** handle to reorder. Number 1 is the top of the queue.
- **Daily list:** Dashboard → *My open tasks*, or Jobs → Board.
- **Log time:** press **t** anywhere, or click **Start timer** on a job. Stop it from the green pill at the top.
- **Bill a job:** Billing → click the job → tick the hours → **Invoice selected** → enter the invoice number and amount. Later, click **Mark paid**.
- **Site visits:** make a task, tick **Site visit**, give it a date and time. It shows up purple on the calendar and in Google Calendar.
- **Repeating tasks:** set **Repeats** on a task. When you tick it done, the next one is created automatically.
- **Reminders:** Settings → **Turn on reminders on this device**. Once a day when you open the app, you get a notification of anything overdue or due today.
- **Remove the sample data:** Settings → **Remove sample data**.

Keyboard shortcuts (desktop): `n` new task · `/` search · `t` log hours · `g` then `d`/`j`/`c`/`a`/`t`/`b`/`r` to jump to Dashboard/Jobs/Clients/Calendar/Time/Billing/Reports · `?` help.

## Making changes later

Open this repository in Claude Code and describe what you want in plain English ("add a Permit number field to jobs", "make the Gantt bars show the assignee"). `CLAUDE.md` at the top of the repository explains how the code is organized so changes can be made safely.

## For developers

```
cd planner
cp .env.example .env     # fill in your Supabase URL + key
npm install
npm run dev              # http://localhost:5173/Who-knows/
npm run build            # production build into dist/
```

Stack: Vite + React + TypeScript, Supabase (Postgres, Auth, Realtime, Edge Functions), @dnd-kit for drag and drop, date-fns. No CSS framework; styles are in `src/index.css`.
