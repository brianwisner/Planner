import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, ok, route } from "@/lib/api";
import { syncSelectedCalendars } from "@/lib/google/calendar";
import { describeGoogleError } from "@/lib/google/client";
import { getPrefs } from "@/lib/services/schedule";
import { audit } from "@/lib/audit";

export const POST = route(async () => {
  const user = await requireUser();
  await assertSameOrigin();
  try {
    const prefs = await getPrefs(user.id);
    const results = await syncSelectedCalendars(user.id, prefs.timezone);
    await audit(user.id, "google.calendar.sync", "user", user.id, `Synced ${results.length} calendar(s)`, results);
    return ok({ results });
  } catch (e) {
    throw new ApiError(describeGoogleError(e), 502);
  }
});
