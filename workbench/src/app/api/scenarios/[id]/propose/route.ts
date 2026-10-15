import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { scenarios } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, idParam, ok, route } from "@/lib/api";
import { createProposal, runRecommendation } from "@/lib/services/schedule";

// Turns a what-if into a normal proposal that still needs the owner's acceptance.
export const POST = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const [s] = await db.select().from(scenarios).where(eq(scenarios.id, id));
  if (!s) throw new ApiError("Scenario not found", 404);
  const run = await runRecommendation(s.userId, { overrides: s.overrides, includeTentative: true });
  const proposal = await createProposal(s.userId, user.id, `What-if: ${s.name}`, run, { scenarioId: s.id, overrides: s.overrides });
  return ok({ proposal }, { status: 201 });
});
