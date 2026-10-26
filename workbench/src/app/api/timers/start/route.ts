import { z } from "zod";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getRunningTimer, startTimer, stopRunningTimer } from "@/lib/services/time";

// Starting a timer stops any running one first (switching projects is one tap).
// The database's partial unique index guarantees there is never more than one running timer per user.
export const POST = route(async (req) => {
  const user = await requireUser();
  await assertSameOrigin();
  const body = await parseBody(req, z.object({ projectId: z.number().int(), taskId: z.number().int().nullable().optional(), notes: z.string().max(2000).nullable().optional(), billable: z.boolean().optional() }));
  const stopped = await stopRunningTimer(user.id);
  await startTimer(user.id, user.timezone, body);
  await audit(user.id, "timer.start", "project", body.projectId, `Started timer${stopped ? ` (stopped previous timer #${stopped.id})` : ""}`);
  return ok({ timer: await getRunningTimer(user.id), stopped, serverTime: new Date().toISOString() }, { status: 201 });
});
