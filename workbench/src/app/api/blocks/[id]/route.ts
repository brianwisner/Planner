import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { workBlocks } from "@/lib/db/schema";
import { assertSameOrigin, requireOwner } from "@/lib/auth/session";
import { ApiError, ConflictError, idParam, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { dayConflict } from "@/lib/services/schedule";
import { clean } from "@/lib/services/common";
import { num } from "@/lib/format";
import { blockSchema } from "../route";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req, ctx: Ctx) => {
  const user = await requireOwner();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const [existing] = await db.select().from(workBlocks).where(eq(workBlocks.id, id));
  if (!existing) throw new ApiError("Block not found", 404);
  const { version, confirmOverbook, userId: _u, ...changes } = await parseBody(req, blockSchema.partial().extend({ version: z.number().int() }));
  const date = changes.date ?? existing.date;
  const hours = changes.hours ?? num(existing.hours);
  let conflict = null;
  if (changes.date !== undefined || changes.hours !== undefined) {
    conflict = await dayConflict(existing.userId, date, hours, id);
    if ((conflict.overbooked || conflict.off) && !confirmOverbook) {
      throw new ApiError(
        conflict.off ? `${date} is not a working day. Move it anyway?` : `This overbooks ${date} by ${conflict.overbookedBy} h (${conflict.totalAfter} h vs ${conflict.availableHours} h available). Move it anyway? Other work will not be moved automatically.`,
        409,
        { conflict },
      );
    }
  }
  const data = clean({ ...changes, hours: changes.hours !== undefined ? String(changes.hours) : undefined });
  const [row] = await db
    .update(workBlocks)
    .set({ ...data, version: sql`${workBlocks.version} + 1`, updatedAt: new Date() })
    .where(and(eq(workBlocks.id, id), eq(workBlocks.version, version)))
    .returning();
  if (!row) {
    const [current] = await db.select().from(workBlocks).where(eq(workBlocks.id, id));
    throw new ConflictError(current);
  }
  const what = Object.keys(changes).map((k) => `${k}=${String((changes as Record<string, unknown>)[k])}`).join(", ");
  await audit(user.id, "block.update", "schedule", id, `Changed block: ${what}${conflict?.overbooked ? " — overbooked, confirmed by owner" : ""}`, { projectId: row.projectId });
  return ok({ block: row, conflict });
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const user = await requireOwner();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const [row] = await db.delete(workBlocks).where(eq(workBlocks.id, id)).returning();
  if (!row) throw new ApiError("Block not found", 404);
  await audit(user.id, "block.delete", "schedule", id, `Removed ${row.hours} h on ${row.date}${row.title ? ` (${row.title})` : ""}`, { projectId: row.projectId });
  return ok({ ok: true, block: row });
});
