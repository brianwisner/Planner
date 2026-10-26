import { requireUser } from "@/lib/auth/session";
import { ok, route } from "@/lib/api";
import { getRunningTimer } from "@/lib/services/time";

export const GET = route(async () => {
  const user = await requireUser();
  const timer = await getRunningTimer(user.id);
  return ok({ timer, serverTime: new Date().toISOString() });
});
