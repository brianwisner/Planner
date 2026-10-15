import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectItems } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, idParam, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { clean, numStr } from "@/lib/services/common";
import { itemSchema } from "../../projects/[id]/items/route";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req, ctx: Ctx) => {
  const user = await requireUser();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const changes = await parseBody(req, itemSchema.partial().extend({ status: z.enum(["open", "resolved"]).optional() }));
  const data: Record<string, unknown> = clean({ ...changes });
  if ("hoursAdded" in changes) data.hoursAdded = numStr(changes.hoursAdded);
  if ("feeAdded" in changes) data.feeAdded = numStr(changes.feeAdded);
  if (changes.status === "resolved") data.resolvedAt = new Date();
  if (changes.status === "open") data.resolvedAt = null;
  const [row] = await db.update(projectItems).set(data).where(eq(projectItems.id, id)).returning();
  if (!row) throw new ApiError("Item not found", 404);
  await audit(user.id, "item.update", "project", row.projectId, `${changes.status === "resolved" ? "Resolved" : "Updated"} ${row.kind.replace("_", " ")}: ${row.description.slice(0, 80)}`);
  return ok({ item: row });
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const user = await requireUser();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const [row] = await db.delete(projectItems).where(eq(projectItems.id, id)).returning();
  if (!row) throw new ApiError("Item not found", 404);
  await audit(user.id, "item.delete", "project", row.projectId, `Removed ${row.kind}: ${row.description.slice(0, 80)}`);
  return ok({ ok: true });
});
