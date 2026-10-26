import { z } from "zod";
import { DateTime } from "luxon";
import { assertSameOrigin, requireOwner } from "@/lib/auth/session";
import { ApiError, ok, parseBody, route } from "@/lib/api";
import { publishBlocks } from "@/lib/google/calendar";
import { describeGoogleError } from "@/lib/google/client";
import { getPrefs } from "@/lib/services/schedule";
import { audit } from "@/lib/audit";

// Publishes the approved schedule to Google Calendar. Explicit action, owner only.
export const POST = route(async (req) => {
  const user = await requireOwner();
  await assertSameOrigin();
  const body = req.headers.get("content-type")?.includes("json") ? await parseBody(req, z.object({ days: z.number().int().min(1).max(180).optional() })) : {};
  const prefs = await getPrefs(user.id);
  const from = DateTime.now().setZone(prefs.timezone).toISODate()!;
  const to = DateTime.fromISO(from).plus({ days: (body.days ?? prefs.horizonDays) - 1 }).toISODate()!;
  try {
    const r = await publishBlocks(user.id, from, to, prefs.timezone);
    await audit(user.id, "google.publish", "schedule", null, `Published schedule to Google Calendar: ${r.created} created, ${r.updated} updated, ${r.deleted} removed`);
    return ok({ ...r, from, to });
  } catch (e) {
    throw new ApiError(describeGoogleError(e), 502);
  }
});
