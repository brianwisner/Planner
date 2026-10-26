import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { googleAccounts } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { SCOPES, getAccount, hasScope } from "@/lib/google/client";

export const PUT = route(async (req) => {
  const user = await requireUser();
  await assertSameOrigin();
  const body = await parseBody(req, z.object({ calendarId: z.string().nullable() }));
  const account = await getAccount(user.id);
  if (!account) throw new ApiError("Connect Google first", 422);
  if (body.calendarId && !hasScope(account, SCOPES.calendarWrite[0])) throw new ApiError("Grant calendar write access first (Connect → Enable write-back).", 422);
  await db.update(googleAccounts).set({ writebackCalendarId: body.calendarId, updatedAt: new Date() }).where(eq(googleAccounts.id, account.id));
  await audit(user.id, "google.writeback", "user", user.id, body.calendarId ? `Enabled calendar write-back to ${body.calendarId}` : "Disabled calendar write-back");
  return ok({ writebackCalendarId: body.calendarId });
});
