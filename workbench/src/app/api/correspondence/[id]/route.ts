import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { correspondence } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, idParam, ok, route } from "@/lib/api";
import { audit } from "@/lib/audit";

export const DELETE = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const [row] = await db.delete(correspondence).where(eq(correspondence.id, id)).returning();
  if (!row) throw new ApiError("Not found", 404);
  await audit(user.id, "correspondence.delete", row.projectId ? "project" : "client", row.projectId ?? row.clientId, `Removed ${row.kind}: ${row.subject ?? ""}`.trim());
  return ok({ ok: true });
});
