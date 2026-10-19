import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, ok, route } from "@/lib/api";
import { refreshCalendarList } from "@/lib/google/calendar";
import { describeGoogleError } from "@/lib/google/client";

export const POST = route(async () => {
  const user = await requireUser();
  await assertSameOrigin();
  try {
    return ok({ count: await refreshCalendarList(user.id) });
  } catch (e) {
    throw new ApiError(describeGoogleError(e), 502);
  }
});
