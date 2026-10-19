import { getCurrentUser } from "@/lib/auth/session";
import { ok, route } from "@/lib/api";

export const GET = route(async () => {
  const u = await getCurrentUser();
  return ok({ user: u });
});
