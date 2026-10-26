import { z } from "zod";
import { db } from "@/lib/db";
import { workBlocks } from "@/lib/db/schema";
import { assertSameOrigin, requireOwner } from "@/lib/auth/session";
import { ApiError, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getOwnerId } from "@/lib/services/users";
import { dayConflict } from "@/lib/services/schedule";

export const blockSchema = z.object({
  userId: z.number().int().optional(),
  projectId: z.number().int().nullable().optional(),
  taskId: z.number().int().nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hours: z.number().min(0.25).max(24),
  startMinute: z.number().int().min(0).max(1440).nullable().optional(),
  kind: z.enum(["work", "commitment"]).optional(),
  title: z.string().max(200).nullable().optional(),
  locked: z.boolean().optional(),
  note: z.string().max(1000).nullable().optional(),
  sortOrder: z.number().int().optional(),
  confirmOverbook: z.boolean().optional(),
});

// Manual scheduling changes the approved schedule, so only the owner may do this.
export const POST = route(async (req) => {
  const user = await requireOwner();
  await assertSameOrigin();
  const body = await parseBody(req, blockSchema);
  const userId = body.userId ?? (await getOwnerId()) ?? user.id;
  if (!body.projectId && !body.title) throw new ApiError("Choose a project or give the commitment a title", 422);
  const conflict = await dayConflict(userId, body.date, body.hours);
  if ((conflict.overbooked || conflict.off) && !body.confirmOverbook) {
    throw new ApiError(
      conflict.off
        ? `${body.date} is not a working day. Add it anyway?`
        : `This overbooks ${body.date} by ${conflict.overbookedBy} h (${conflict.totalAfter} h planned vs ${conflict.availableHours} h available). Add it anyway? Other work will not be moved automatically.`,
      409,
      { conflict },
    );
  }
  const { confirmOverbook: _c, userId: _u, ...data } = body;
  const [row] = await db
    .insert(workBlocks)
    .values({ ...data, userId, hours: String(body.hours), kind: body.kind ?? (body.projectId ? "work" : "commitment"), locked: body.locked ?? body.kind === "commitment", source: "manual" })
    .returning();
  await audit(user.id, "block.create", "schedule", row.id, `Scheduled ${body.hours} h on ${body.date}${body.title ? ` (${body.title})` : ""}${conflict.overbooked ? " — overbooked, confirmed by owner" : ""}`, { projectId: body.projectId, conflict });
  return ok({ block: row, conflict }, { status: 201 });
});
