# Deployment, backups and maintenance

Plain-language guide for running Wisner Workbench. Nothing here has been purchased or signed up for on your behalf; every paid step is marked **(paid)** with an approximate price. Prices are from memory and were not verified online during the build, so confirm them on the provider's pricing page before committing.

## 1. What the app needs

| Piece | Purpose | Options |
|---|---|---|
| Node.js host | runs the app (one small container) | Railway, Render, Fly.io, a $6/mo VPS, or Vercel |
| PostgreSQL database | all your data | Railway/Render Postgres, Neon, Supabase, or the same VPS |
| Environment variables | secrets and settings | set in the host's dashboard, never in code |
| Google Cloud OAuth client (optional) | Gmail + Calendar | free |

The app ships with a `Dockerfile` that builds, applies database migrations on start, and serves on port 3000.

## 2. Recommended path: Railway (simplest, one dashboard) **(paid, roughly $5–15/month)**

1. Create a Railway account and a new project. Choose **Deploy from GitHub repo**, pick this repository, and set the **Root Directory** to `workbench`. Railway will detect the Dockerfile.
2. Add a **PostgreSQL** service to the project. Railway creates a `DATABASE_URL` for it.
3. On the app service, open **Variables** and add the values from section 4 below. For `DATABASE_URL` use Railway's reference to the Postgres service.
4. Open **Settings → Networking → Generate domain**. Put that URL (with `https://`) in `APP_URL`, then redeploy.
5. Visit the URL. The first visit shows the **Set up Workbench** page; create Brian's owner account there.
6. Turn on database backups in the Postgres service settings (availability depends on plan).

Alternatives with the same steps: **Render** (Web Service + Postgres, roughly $7 + $7/month), **Fly.io** (small machine + Postgres, roughly $5–10/month), **Vercel + Neon** (Vercel's free plan is for non-commercial use; a business should expect the $20/month plan; Neon has a free tier). A self-managed VPS with Docker Compose is the cheapest (about $6/month) but you own updates and backups; `docker-compose.yml` in this folder works for that.

## 3. Local or self-hosted run

```
cd workbench
cp .env.example .env            # fill in values
npm install
npm run migrate                 # creates tables
npm run build && npm start      # http://localhost:3000
```
Or with Docker: `docker compose up -d` (uses `docker-compose.yml`, which starts Postgres and the app).

## 4. Environment variables

| Name | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `SESSION_SECRET` | yes | long random string: `openssl rand -base64 48` |
| `TOKEN_ENCRYPTION_KEY` | yes | 32 random bytes, base64: `openssl rand -base64 32`. Encrypts Google tokens. **Losing it means reconnecting Google**, nothing else. |
| `APP_URL` | yes | public URL, no trailing slash, e.g. `https://workbench.up.railway.app` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Google | from section 5 |
| `APP_ENV` | no | set to `demo` only on a throwaway environment to enable sample data; never in production |
| `DEFAULT_TIMEZONE` | no | defaults to `America/Los_Angeles` |

## 5. Google Cloud setup (Gmail and Calendar) — free, about 20 minutes

1. Go to https://console.cloud.google.com, create a project (e.g. "Wisner Workbench").
2. **APIs & Services → Library**: enable **Google Calendar API** and **Gmail API**.
3. **APIs & Services → OAuth consent screen**:
   - If your email is a Google Workspace account (a paid business Google account on your own domain), choose **Internal**. This is the best case: no verification, and connections do not expire.
   - If you use a plain @gmail.com account, choose **External**, fill in the app name and your email, and under **Test users** add Brian's and Erika's addresses.
   - Add scopes: `.../auth/calendar.readonly`, `.../auth/calendar.events`, `.../auth/gmail.readonly`, `.../auth/userinfo.email`, `openid`.
4. **Credentials → Create credentials → OAuth client ID → Web application**. Add the authorized redirect URI: `APP_URL/api/google/callback` (for local use also `http://localhost:3000/api/google/callback`). Copy the client ID and secret into the environment variables and redeploy.
5. In the app, open **Settings → Google** and click Connect. Each user connects their own account.

**Honest caveat for @gmail.com accounts.** While the consent screen is in "Testing", Google expires the connection every 7 days, so you will see "reconnect your Google account" weekly. Moving the app to "In production" removes that for the Calendar scopes (you see a one-time "unverified app" warning), but the Gmail read scope is classed *restricted* and Google requires a formal verification and security review before an unverified production app may use it. In practice: Calendar works fine either way; Gmail works smoothly only with a Workspace (Internal) account, or with weekly reconnects in Testing mode. Decide which you prefer before setting up.

## 6. Backup and restore

- **Provider backups**: turn on automatic backups / point-in-time restore in your database provider. Check it after the first week.
- **Your own copy, monthly**: Settings → Data → **Everything (JSON)**, keep the file with your business records.
- **Full database dump** (restorable):
  ```
  pg_dump "$DATABASE_URL" --format=custom --file=workbench-$(date +%F).dump
  ```
- **Restore** into an empty database:
  ```
  pg_restore --clean --if-exists --no-owner --dbname="$NEW_DATABASE_URL" workbench-YYYY-MM-DD.dump
  ```
  then point `DATABASE_URL` at the restored database and redeploy. If you only have the JSON export, the data is readable in any editor or spreadsheet; re-importing it would need a small script.

## 7. Updates and maintenance

- **Deploying a change**: push to the branch Railway/Render watches; the Dockerfile runs `migrate` then starts. Watch the deploy log for "Migrations applied."
- **Schema changes** (for a developer): edit `src/lib/db/schema.ts`, run `npm run db:generate`, commit the new file in `drizzle/`.
- **Dependencies**: run `npm outdated` quarterly; `npm audit` for security notices; test with `npm run test:all` before deploying.
- **Secrets**: rotate `SESSION_SECRET` to sign everyone out; rotating `TOKEN_ENCRYPTION_KEY` requires reconnecting Google.
- **Monitoring**: `GET /api/health` returns `{ok:true}` when the app can reach the database; most hosts can ping it.
- **Logs**: errors are printed to the host's log stream; Google failures also appear on Settings → Google and the Inbox page.
- **Resetting a password**: the owner can reset any user's password on Settings → Users. If the owner forgets theirs, a developer can run `node -e "console.log(require('bcryptjs').hashSync('newpassword',12))"` and update `users.password_hash` in the database.
