import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { estimateLines, estimates } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { listEstimates } from "@/lib/services/estimates";

export const lineSchema = z.object({
  phase: z.string().max(100).nullable().optional(),
  description: z.string().min(1).max(1000),
  hours: z.number().min(0).max(10000),
  rate: z.number().min(0).nullable().optional(),
  amount: z.number().min(0).nullable().optional(),
});
export const estimateSchema = z.object({
  projectId: z.number().int(),
  title: z.string().max(200).nullable().optional(),
  scopeKind: z.enum(["original", "added"]).optional(),
  feeType: z.enum(["hourly", "fixed"]),
  hourlyRate: z.number().min(0).nullable().optional(),
  lines: z.array(lineSchema).min(0),
  assumptions: z.string().max(10000).nullable().optional(),
  exclusions: z.string().max(10000).nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
  recommendation: z.unknown().optional(),
  supersedesId: z.number().int().nullable().optional(),
  fixedTotal: z.number().min(0).nullable().optional(), // for fixed-fee estimates, overrides the sum of lines when given
});

export function computeTotals(b: { feeType: "hourly" | "fixed"; hourlyRate?: number | null; lines: z.infer<typeof lineSchema>[]; fixedTotal?: number | null }) {
  const rate = b.hourlyRate ?? 0;
  const lines = b.lines.map((l, i) => {
    const r = l.rate ?? rate;
    const amount = l.amount != null ? l.amount : Math.round(l.hours * r * 100) / 100;
    return { ...l, rate: r, amount, sortOrder: i };
  });
  const totalHours = Math.round(lines.reduce((s, l) => s + l.hours, 0) * 100) / 100;
  const sum = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const totalFee = b.feeType === "fixed" && b.fixedTotal != null ? b.fixedTotal : sum;
  return { lines, totalHours, totalFee };
}

export const GET = route(async (req) => {
  await requireUser();
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  return ok({ estimates: await listEstimates({ status: url.searchParams.get("status") ?? undefined, projectId: projectId ? Number(projectId) : undefined }) });
});

export const POST = route(async (req) => {
  const user = await requireUser();
  await assertSameOrigin();
  const body = await parseBody(req, estimateSchema);
  const { lines, totalHours, totalFee } = computeTotals(body);
  let revision = 1;
  if (body.supersedesId) {
    const [prev] = await db.select().from(estimates).where(eq(estimates.id, body.supersedesId));
    if (!prev || prev.projectId !== body.projectId) throw new ApiError("Previous estimate not found for this project", 422);
    revision = prev.revision + 1;
  }
  const row = await db.transaction(async (tx) => {
    const [e] = await tx
      .insert(estimates)
      .values({
        projectId: body.projectId,
        revision,
        supersedesId: body.supersedesId ?? null,
        scopeKind: body.scopeKind ?? "original",
        status: "draft",
        feeType: body.feeType,
        hourlyRate: body.hourlyRate != null ? String(body.hourlyRate) : null,
        totalHours: String(totalHours),
        totalFee: String(totalFee),
        title: body.title ?? null,
        assumptions: body.assumptions ?? null,
        exclusions: body.exclusions ?? null,
        notes: body.notes ?? null,
        recommendation: body.recommendation ?? null,
        preparedBy: user.id,
      })
      .returning();
    if (lines.length) await tx.insert(estimateLines).values(lines.map((l) => ({ ...l, estimateId: e.id, hours: String(l.hours), rate: l.rate != null ? String(l.rate) : null, amount: String(l.amount) })));
    return e;
  });
  await audit(user.id, "estimate.create", "estimate", row.id, `Prepared estimate rev ${revision} (${totalHours} h, $${totalFee})`, { projectId: body.projectId });
  await audit(user.id, "estimate.create", "project", body.projectId, `Estimate #${row.id} rev ${revision} prepared by ${user.name}`);
  return ok({ estimate: row }, { status: 201 });
});
