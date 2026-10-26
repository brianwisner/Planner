import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendars } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { ok, route } from "@/lib/api";
import { SCOPES, getAccount, googleConfigured, hasScope } from "@/lib/google/client";

export const GET = route(async () => {
  const user = await requireUser();
  const account = await getAccount(user.id);
  const cals = account ? await db.select().from(calendars).where(eq(calendars.googleAccountId, account.id)).orderBy(asc(calendars.summary)) : [];
  return ok({
    configured: googleConfigured(),
    account: account
      ? {
          email: account.googleEmail,
          status: account.status,
          lastError: account.lastError,
          gmailLastScanAt: account.gmailLastScanAt,
          gmailLastError: account.gmailLastError,
          writebackCalendarId: account.writebackCalendarId,
          calendar: hasScope(account, SCOPES.calendar[0]),
          calendarWrite: hasScope(account, SCOPES.calendarWrite[0]),
          gmail: hasScope(account, SCOPES.gmail[0]),
        }
      : null,
    calendars: cals,
  });
});
