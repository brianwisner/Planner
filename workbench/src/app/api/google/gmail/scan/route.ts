import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, ok, route } from "@/lib/api";
import { scanGmail } from "@/lib/google/gmail";
import { audit } from "@/lib/audit";

export const POST = route(async () => {
  const user = await requireUser();
  await assertSameOrigin();
  try {
    const r = await scanGmail(user.id);
    await audit(user.id, "google.gmail.scan", "user", user.id, `Scanned Gmail: ${r.scanned} recent messages, ${r.stored} new`);
    return ok(r);
  } catch (e) {
    throw new ApiError((e as Error).message, 502);
  }
});
