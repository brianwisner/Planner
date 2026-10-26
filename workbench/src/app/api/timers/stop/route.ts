import { z } from "zod";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { stopRunningTimer } from "@/lib/services/time";

export const POST = route(async (req) => {
  const user = await requireUser();
  await assertSameOrigin();
  const body = req.headers.get("content-type")?.includes("json") ? await parseBody(req, z.object({ notes: z.string().max(2000).nullable().optional() })) : {};
  const entry = await stopRunningTimer(user.id, body.notes);
  if (!entry) throw new ApiError("No timer is running", 404);
  await audit(user.id, "timer.stop", "project", entry.projectId, `Stopped timer: ${entry.durationMinutes} min`);
  return ok({ entry });
});
