import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { scheduleProposals, projects } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, idParam, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { forecastFromBlocks } from "@/lib/engine/scheduler";
import { getCapacity } from "@/lib/services/schedule";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req, ctx: Ctx) => {
  await requireUser();
  const id = await idParam(ctx);
  const [p] = await db.select().from(scheduleProposals).where(eq(scheduleProposals.id, id));
  if (!p) throw new ApiError("Proposal not found", 404);
  const names = await db.select({ id: projects.id, name: projects.name, clientDueDate: projects.clientDueDate }).from(projects);
  const { days } = await getCapacity(p.userId, p.summary.horizonStart, p.summary.horizonEnd);
  return ok({ proposal: p, projectNames: Object.fromEntries(names.map((n) => [n.id, n.name])), days: days.map((d) => ({ date: d.date, availableHours: d.availableHours, off: d.off })) });
});

// Adjust the proposed blocks before deciding. Allowed for any user while the proposal is open.
export const PATCH = route(async (req, ctx: Ctx) => {
  const user = await requireUser();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const body = await parseBody(req, z.object({ blocks: z.array(z.object({ projectId: z.number().int(), date: z.string(), hours: z.number().min(0).max(24), locked: z.boolean().optional(), existingId: z.number().int().optional() })) }));
  const [p] = await db.select().from(scheduleProposals).where(eq(scheduleProposals.id, id));
  if (!p) throw new ApiError("Proposal not found", 404);
  if (p.status !== "proposed") throw new ApiError(`Proposal is already ${p.status}`, 422);
  const blocks = body.blocks.filter((b) => b.hours > 0);
  const forecasts = p.summary.forecasts.map((f) => ({ ...f, forecastCompletion: forecastFromBlocks(blocks, f.projectId) ?? f.forecastCompletion }));
  const [row] = await db
    .update(scheduleProposals)
    .set({ blocks, summary: { ...p.summary, forecasts, warnings: [...p.summary.warnings.filter((w) => !w.startsWith("Adjusted")), `Adjusted manually by ${user.name}`] } })
    .where(eq(scheduleProposals.id, id))
    .returning();
  await audit(user.id, "proposal.adjust", "proposal", id, `Adjusted proposed schedule "${p.title}"`);
  return ok({ proposal: row });
});
