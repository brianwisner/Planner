import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { estimateLines, estimates } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, ConflictError, idParam, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getEstimateFull } from "@/lib/services/estimates";
import { computeTotals, estimateSchema } from "../route";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req, ctx: Ctx) => {
  await requireUser();
  const id = await idParam(ctx);
  const estimate = await getEstimateFull(id);
  if (!estimate) throw new ApiError("Estimate not found", 404);
  return ok({ estimate });
});

// Drafts and submitted estimates can be edited; approved ones are frozen (make a revision instead).
export const PATCH = route(async (req, ctx: Ctx) => {
  const user = await requireUser();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const body = await parseBody(req, estimateSchema.omit({ projectId: true, supersedesId: true }).partial().extend({ version: z.number().int() }));
  const [existing] = await db.select().from(estimates).where(eq(estimates.id, id));
  if (!existing) throw new ApiError("Estimate not found", 404);
  if (existing.status === "approved" || existing.status === "superseded") throw new ApiError("Approved estimates are kept for comparison and cannot be edited. Create a revision instead.", 422);
  const feeType = body.feeType ?? existing.feeType;
  const hourlyRate = body.hourlyRate !== undefined ? body.hourlyRate : existing.hourlyRate != null ? Number(existing.hourlyRate) : null;
  const currentLines = await db.select().from(estimateLines).where(eq(estimateLines.estimateId, id));
  const lines = body.lines ?? currentLines.map((l) => ({ phase: l.phase, description: l.description, hours: Number(l.hours), rate: l.rate != null ? Number(l.rate) : null, amount: null }));
  const totals = computeTotals({ feeType, hourlyRate, lines, fixedTotal: body.fixedTotal });
  const row = await db.transaction(async (tx) => {
    const [e] = await tx
      .update(estimates)
      .set({
        title: body.title !== undefined ? body.title : existing.title,
        scopeKind: body.scopeKind ?? existing.scopeKind,
        feeType,
        hourlyRate: hourlyRate != null ? String(hourlyRate) : null,
        totalHours: String(totals.totalHours),
        totalFee: String(totals.totalFee),
        assumptions: body.assumptions !== undefined ? body.assumptions : existing.assumptions,
        exclusions: body.exclusions !== undefined ? body.exclusions : existing.exclusions,
        notes: body.notes !== undefined ? body.notes : existing.notes,
        recommendation: body.recommendation !== undefined ? body.recommendation : existing.recommendation,
        status: existing.status === "rejected" ? "draft" : existing.status,
        version: sql`${estimates.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(estimates.id, id), eq(estimates.version, body.version)))
      .returning();
    if (!e) return null;
    if (body.lines) {
      await tx.delete(estimateLines).where(eq(estimateLines.estimateId, id));
      if (totals.lines.length) await tx.insert(estimateLines).values(totals.lines.map((l) => ({ ...l, estimateId: id, hours: String(l.hours), rate: l.rate != null ? String(l.rate) : null, amount: String(l.amount) })));
    }
    return e;
  });
  if (!row) throw new ConflictError(await getEstimateFull(id));
  await audit(user.id, "estimate.update", "estimate", id, `Edited estimate rev ${row.revision} (${totals.totalHours} h, $${totals.totalFee})`, { projectId: row.projectId });
  return ok({ estimate: row });
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const user = await requireUser();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const [existing] = await db.select().from(estimates).where(eq(estimates.id, id));
  if (!existing) throw new ApiError("Estimate not found", 404);
  if (existing.status !== "draft") throw new ApiError("Only drafts can be deleted", 422);
  await db.delete(estimates).where(eq(estimates.id, id));
  await audit(user.id, "estimate.delete", "project", existing.projectId, `Deleted draft estimate #${id}`);
  return ok({ ok: true });
});
