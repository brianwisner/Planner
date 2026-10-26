import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, ConflictError, idParam, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { clean, numStr } from "@/lib/services/common";
import { taskSchema } from "../../projects/[id]/tasks/route";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req, ctx: Ctx) => {
  const user = await requireUser();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const { version, ...changes } = await parseBody(req, taskSchema.partial().extend({ version: z.number().int().optional() }));
  const data: Record<string, unknown> = clean({ ...changes });
  if ("estimatedHours" in changes) data.estimatedHours = numStr(changes.estimatedHours);
  if ("remainingHours" in changes) data.remainingHours = numStr(changes.remainingHours);
  if (changes.status === "done" && !("remainingHours" in changes)) data.remainingHours = "0";
  const where = version != null ? and(eq(tasks.id, id), eq(tasks.version, version)) : eq(tasks.id, id);
  const [row] = await db.update(tasks).set({ ...data, version: sql`${tasks.version} + 1`, updatedAt: new Date() }).where(where).returning();
  if (!row) {
    const [current] = await db.select().from(tasks).where(eq(tasks.id, id));
    if (!current) throw new ApiError("Task not found", 404);
    throw new ConflictError(current);
  }
  await audit(user.id, "task.update", "project", row.projectId, `Updated task ${row.name}${changes.status ? ` (${changes.status})` : ""}`);
  return ok({ task: row });
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const user = await requireUser();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const [row] = await db.delete(tasks).where(eq(tasks.id, id)).returning();
  if (!row) throw new ApiError("Task not found", 404);
  await audit(user.id, "task.delete", "project", row.projectId, `Removed task ${row.name}`);
  return ok({ ok: true });
});
