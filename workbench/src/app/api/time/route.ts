import { z } from "zod";
import { db } from "@/lib/db";
import { timeEntries } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { listTimeEntries } from "@/lib/services/time";
import { todayISO } from "@/lib/format";

export const timeEntrySchema = z.object({
  projectId: z.number().int(),
  taskId: z.number().int().nullable().optional(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationMinutes: z.number().int().min(1).max(24 * 60),
  notes: z.string().max(2000).nullable().optional(),
  billable: z.boolean().optional(),
});

export const GET = route(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? todayISO(user.timezone);
  const to = url.searchParams.get("to") ?? from;
  const scope = url.searchParams.get("scope"); // "all" lists both users
  const projectId = url.searchParams.get("projectId");
  const entries = await listTimeEntries({ userId: scope === "all" ? undefined : user.id, from, to, projectId: projectId ? Number(projectId) : undefined });
  return ok({ entries });
});

export const POST = route(async (req) => {
  const user = await requireUser();
  await assertSameOrigin();
  const body = await parseBody(req, timeEntrySchema);
  if (body.entryDate > todayISO(user.timezone)) throw new ApiError("Time cannot be entered for a future date", 422);
  const [row] = await db.insert(timeEntries).values({ ...body, userId: user.id, source: "manual" }).returning();
  await audit(user.id, "time.create", "project", body.projectId, `Logged ${body.durationMinutes} min on ${body.entryDate}`);
  return ok({ entry: row }, { status: 201 });
});
