import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { estimates } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, idParam, ok, route } from "@/lib/api";
import { audit } from "@/lib/audit";

// Anyone can submit a draft for the owner's approval.
export const POST = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const [row] = await db
    .update(estimates)
    .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(estimates.id, id), eq(estimates.status, "draft")))
    .returning();
  if (!row) throw new ApiError("Only a draft can be submitted", 422);
  await audit(user.id, "estimate.submit", "estimate", id, `Submitted estimate rev ${row.revision} for approval`, { projectId: row.projectId });
  await audit(user.id, "estimate.submit", "project", row.projectId, `Estimate #${id} submitted for approval by ${user.name}`);
  return ok({ estimate: row });
});
