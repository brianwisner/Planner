import { z } from "zod";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { idParam, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { numStr, zDate, zNum } from "@/lib/services/common";

export const taskSchema = z.object({
  name: z.string().min(1).max(300),
  phase: z.string().max(100).nullable().optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  isMilestone: z.boolean().optional(),
  dueDate: zDate,
  estimatedHours: zNum,
  remainingHours: zNum,
  dependsOnTaskId: z.number().int().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  await assertSameOrigin();
  const projectId = await idParam(ctx);
  const body = await parseBody(req, taskSchema);
  const est = numStr(body.estimatedHours);
  const [row] = await db
    .insert(tasks)
    .values({ ...body, projectId, estimatedHours: est, remainingHours: body.remainingHours !== undefined ? numStr(body.remainingHours) : est })
    .returning();
  await audit(user.id, "task.create", "project", projectId, `Added task ${row.name}`);
  return ok({ task: row }, { status: 201 });
});
