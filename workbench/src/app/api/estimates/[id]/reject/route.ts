import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { estimates } from "@/lib/db/schema";
import { assertSameOrigin, requireOwner } from "@/lib/auth/session";
import { ApiError, idParam, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireOwner();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const body = req.headers.get("content-type")?.includes("json") ? await parseBody(req, z.object({ note: z.string().max(2000).nullable().optional() })) : {};
  const [row] = await db
    .update(estimates)
    .set({ status: "rejected", decisionNote: body.note ?? null, approvedBy: user.id, approvedAt: null, updatedAt: new Date() })
    .where(and(eq(estimates.id, id), inArray(estimates.status, ["draft", "submitted"])))
    .returning();
  if (!row) throw new ApiError("Estimate not found or already decided", 404);
  await audit(user.id, "estimate.reject", "estimate", id, `Returned estimate rev ${row.revision} for changes${body.note ? `: ${body.note}` : ""}`, { projectId: row.projectId });
  await audit(user.id, "estimate.reject", "project", row.projectId, `Estimate #${id} returned for changes by ${user.name}`);
  return ok({ estimate: row });
});
