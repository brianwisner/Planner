import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { scenarios } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { ApiError, idParam, ok, route } from "@/lib/api";
import { runRecommendation } from "@/lib/services/schedule";

// Computes a what-if result in memory. Nothing is written to the approved schedule.
export const POST = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  await requireUser();
  const id = await idParam(ctx);
  const [s] = await db.select().from(scenarios).where(eq(scenarios.id, id));
  if (!s) throw new ApiError("Scenario not found", 404);
  const [baseline, whatIf] = await Promise.all([
    runRecommendation(s.userId, { horizonDays: s.overrides.horizonDays, includeTentative: true }),
    runRecommendation(s.userId, { overrides: s.overrides, includeTentative: true }),
  ]);
  return ok({
    scenario: s,
    baseline: { summary: baseline.summary, dayLoad: baseline.result.dayLoad },
    whatIf: { summary: whatIf.summary, dayLoad: whatIf.result.dayLoad, blocks: whatIf.blocks },
  });
});
