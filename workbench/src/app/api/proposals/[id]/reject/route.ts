import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { scheduleProposals } from "@/lib/db/schema";
import { assertSameOrigin, requireOwner } from "@/lib/auth/session";
import { ApiError, idParam, ok, route } from "@/lib/api";
import { audit } from "@/lib/audit";

export const POST = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireOwner();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const [row] = await db
    .update(scheduleProposals)
    .set({ status: "rejected", decidedBy: user.id, decidedAt: new Date() })
    .where(and(eq(scheduleProposals.id, id), eq(scheduleProposals.status, "proposed")))
    .returning();
  if (!row) throw new ApiError("Proposal not found or already decided", 404);
  await audit(user.id, "proposal.reject", "proposal", id, `Rejected schedule proposal "${row.title}"`);
  return ok({ proposal: row });
});
