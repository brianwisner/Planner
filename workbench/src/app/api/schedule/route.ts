import { DateTime } from "luxon";
import { requireUser } from "@/lib/auth/session";
import { ok, route } from "@/lib/api";
import { getOwnerId } from "@/lib/services/users";
import { getBlocks, getCapacity, summarizeRange } from "@/lib/services/schedule";
import { listProjects } from "@/lib/services/projects";

// Approved schedule + capacity for a date range.
export const GET = route(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const userId = Number(url.searchParams.get("userId") ?? (await getOwnerId()) ?? user.id);
  const from = url.searchParams.get("from") ?? DateTime.now().setZone(user.timezone).toISODate()!;
  const to = url.searchParams.get("to") ?? DateTime.fromISO(from).plus({ days: 13 }).toISODate()!;
  const [{ days, prefs, tz }, blocks, projects] = await Promise.all([getCapacity(userId, from, to), getBlocks(userId, from, to), listProjects({ status: ["accepted", "in_progress", "inquiry", "proposed", "on_hold"] })]);
  return ok({ userId, from, to, tz, prefs, days: summarizeRange(days, blocks), projects });
});
