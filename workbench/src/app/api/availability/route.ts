import { requireUser } from "@/lib/auth/session";
import { ok, route } from "@/lib/api";
import { getAvailability } from "@/lib/services/schedule";

export const GET = route(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const userId = Number(url.searchParams.get("userId") ?? user.id);
  return ok(await getAvailability(userId));
});
