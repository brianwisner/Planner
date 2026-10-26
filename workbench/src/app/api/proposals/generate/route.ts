import { z } from "zod";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ok, parseBody, route } from "@/lib/api";
import { createProposal, runRecommendation } from "@/lib/services/schedule";
import { getOwnerId } from "@/lib/services/users";

// Anyone can generate a recommendation. It is only a proposal until the owner accepts it.
export const POST = route(async (req) => {
  const user = await requireUser();
  await assertSameOrigin();
  const body = await parseBody(
    req,
    z.object({ userId: z.number().int().optional(), horizonDays: z.number().int().min(7).max(180).optional(), includeTentative: z.boolean().optional(), title: z.string().max(200).optional(), save: z.boolean().optional() }),
  );
  const userId = body.userId ?? (await getOwnerId()) ?? user.id;
  const run = await runRecommendation(userId, { horizonDays: body.horizonDays, includeTentative: body.includeTentative });
  if (body.save === false) return ok({ preview: { blocks: run.blocks, summary: run.summary, dayLoad: run.result.dayLoad } });
  const title = body.title ?? `Recommendation ${run.today}${body.includeTentative ? " (with tentative work)" : ""}`;
  const proposal = await createProposal(userId, user.id, title, run, { horizonDays: body.horizonDays, includeTentative: body.includeTentative });
  return ok({ proposal, dayLoad: run.result.dayLoad }, { status: 201 });
});
