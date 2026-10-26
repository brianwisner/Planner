import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { timeEntries } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, ConflictError, idParam, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { clean } from "@/lib/services/common";
import { timeEntrySchema } from "../route";

type Ctx = { params: Promise<{ id: string }> };

async function load(id: number) {
  const [row] = await db.select().from(timeEntries).where(eq(timeEntries.id, id));
  if (!row) throw new ApiError("Time entry not found", 404);
  return row;
}

export const PATCH = route(async (req, ctx: Ctx) => {
  const user = await requireUser();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const existing = await load(id);
  if (existing.userId !== user.id && user.role !== "owner") throw new ApiError("You can only edit your own time", 403);
  if (!existing.endedAt && existing.startedAt) throw new ApiError("Stop the timer before editing this entry", 422);
  const { version, ...changes } = await parseBody(req, timeEntrySchema.partial().extend({ version: z.number().int() }));
  const [row] = await db
    .update(timeEntries)
    .set({ ...clean(changes), version: sql`${timeEntries.version} + 1`, updatedAt: new Date() })
    .where(and(eq(timeEntries.id, id), eq(timeEntries.version, version)))
    .returning();
  if (!row) throw new ConflictError(await load(id));
  await audit(user.id, "time.update", "project", row.projectId, `Edited time entry #${id} (${row.durationMinutes} min on ${row.entryDate})`);
  return ok({ entry: row });
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const user = await requireUser();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const existing = await load(id);
  if (existing.userId !== user.id && user.role !== "owner") throw new ApiError("You can only delete your own time", 403);
  await db.delete(timeEntries).where(eq(timeEntries.id, id));
  await audit(user.id, "time.delete", "project", existing.projectId, `Deleted time entry #${id} (${existing.durationMinutes} min on ${existing.entryDate})`);
  return ok({ ok: true });
});
