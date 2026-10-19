import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendarEvents, calendars, googleAccounts } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, idParam, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";

export const PATCH = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const body = await parseBody(req, z.object({ affectsAvailability: z.boolean() }));
  const [row] = await db
    .select({ c: calendars })
    .from(calendars)
    .innerJoin(googleAccounts, eq(googleAccounts.id, calendars.googleAccountId))
    .where(and(eq(calendars.id, id), eq(googleAccounts.userId, user.id)));
  if (!row) throw new ApiError("Calendar not found", 404);
  const [updated] = await db.update(calendars).set({ affectsAvailability: body.affectsAvailability, syncToken: body.affectsAvailability ? row.c.syncToken : null }).where(eq(calendars.id, id)).returning();
  if (!body.affectsAvailability) await db.delete(calendarEvents).where(eq(calendarEvents.calendarId, id));
  await audit(user.id, "google.calendar.select", "user", user.id, `${body.affectsAvailability ? "Included" : "Excluded"} calendar "${row.c.summary}" ${body.affectsAvailability ? "in" : "from"} availability`);
  return ok({ calendar: updated });
});
