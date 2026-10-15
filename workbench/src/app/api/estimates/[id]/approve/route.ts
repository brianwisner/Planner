import { z } from "zod";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { estimates } from "@/lib/db/schema";
import { assertSameOrigin, requireOwner } from "@/lib/auth/session";
import { ApiError, idParam, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { syncProjectFromApprovedEstimates } from "@/lib/services/estimates";

// Owner only. Enforced on the server regardless of what the UI shows.
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireOwner();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const body = req.headers.get("content-type")?.includes("json") ? await parseBody(req, z.object({ note: z.string().max(2000).nullable().optional() })) : {};
  const [existing] = await db.select().from(estimates).where(eq(estimates.id, id));
  if (!existing) throw new ApiError("Estimate not found", 404);
  if (!["draft", "submitted"].includes(existing.status)) throw new ApiError(`Estimate is already ${existing.status}`, 422);
  const row = await db.transaction(async (tx) => {
    // Earlier approved estimates of the same scope kind are kept but marked superseded.
    await tx
      .update(estimates)
      .set({ status: "superseded", updatedAt: new Date() })
      .where(and(eq(estimates.projectId, existing.projectId), eq(estimates.scopeKind, existing.scopeKind), eq(estimates.status, "approved"), ne(estimates.id, id)));
    const [r] = await tx
      .update(estimates)
      .set({ status: "approved", approvedBy: user.id, approvedAt: new Date(), decisionNote: body.note ?? null, updatedAt: new Date() })
      .where(eq(estimates.id, id))
      .returning();
    return r;
  });
  await syncProjectFromApprovedEstimates(existing.projectId);
  await audit(user.id, "estimate.approve", "estimate", id, `Approved estimate rev ${row.revision}: ${row.totalHours} h, $${row.totalFee}`, { projectId: row.projectId, note: body.note });
  await audit(user.id, "estimate.approve", "project", row.projectId, `Estimate #${id} rev ${row.revision} approved by ${user.name} (${row.totalHours} h, $${row.totalFee})`);
  return ok({ estimate: row });
});

export const estimateIds = inArray;
