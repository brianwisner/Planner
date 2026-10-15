import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectTypes } from "@/lib/db/schema";
import { assertSameOrigin, requireOwner } from "@/lib/auth/session";
import { ApiError, idParam, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { clean, numStr } from "@/lib/services/common";
import { projectTypeSchema } from "../route";

export const PATCH = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireOwner();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const changes = await parseBody(req, projectTypeSchema.partial());
  const data: Record<string, unknown> = clean({ ...changes });
  if ("defaultFee" in changes) data.defaultFee = numStr(changes.defaultFee);
  if ("defaultHours" in changes) data.defaultHours = numStr(changes.defaultHours);
  const [row] = await db.update(projectTypes).set(data).where(eq(projectTypes.id, id)).returning();
  if (!row) throw new ApiError("Project type not found", 404);
  await audit(user.id, "project_type.update", "project_type", id, `Updated project type ${row.name}`);
  return ok({ projectType: row });
});
