import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { calendars } from "@/lib/db/schema";
import { getAccount, googleConfigured, hasScope, redirectUri, SCOPES } from "@/lib/google/client";
import { PageHeader } from "@/components/ui/PageHeader";
import { GoogleSettings } from "@/components/settings/GoogleSettings";
import { Notice } from "@/components/ui/Notice";

export const metadata = { title: "Google" };

export default async function GooglePage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const account = await getAccount(user.id);
  const cals = account ? await db.select().from(calendars).where(eq(calendars.googleAccountId, account.id)).orderBy(asc(calendars.summary)) : [];
  return (
    <div>
      <PageHeader title="Google Calendar & Gmail" subtitle="Each user connects their own Google account. Only the permissions you choose are requested." back={<Link href="/settings" className="link">← Settings</Link>} />
      {sp.ok && <div className="mb-3"><Notice kind="ok">{sp.ok}</Notice></div>}
      {sp.error && <div className="mb-3"><Notice kind="danger">{sp.error}</Notice></div>}
      {!googleConfigured() ? (
        <Notice kind="warn">
          <div className="font-medium mb-1">Google integration is not configured on the server yet.</div>
          <div className="text-sm">An administrator needs to create a Google Cloud OAuth client and set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and APP_URL. The redirect URI to register is <code>{process.env.APP_URL ? redirectUri() : "<APP_URL>/api/google/callback"}</code>. Step-by-step instructions are in docs/DEPLOYMENT.md.</div>
        </Notice>
      ) : (
        <GoogleSettings
          account={account ? { email: account.googleEmail, status: account.status, lastError: account.lastError, gmailLastScanAt: account.gmailLastScanAt?.toISOString() ?? null, gmailLastError: account.gmailLastError, writebackCalendarId: account.writebackCalendarId, calendar: hasScope(account, SCOPES.calendar[0]), calendarWrite: hasScope(account, SCOPES.calendarWrite[0]), gmail: hasScope(account, SCOPES.gmail[0]) } : null}
          calendars={cals.map((c) => ({ id: c.id, googleCalendarId: c.googleCalendarId, summary: c.summary, isPrimary: c.isPrimary, accessRole: c.accessRole, affectsAvailability: c.affectsAvailability, lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null, lastError: c.lastError }))}
          isOwner={user.role === "owner"}
        />
      )}
    </div>
  );
}
