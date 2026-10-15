import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { scheduleProposals, users } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { ok, route } from "@/lib/api";

export const GET = route(async (req) => {
  await requireUser();
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const rows = await db
    .select({
      id: scheduleProposals.id,
      userId: scheduleProposals.userId,
      title: scheduleProposals.title,
      status: scheduleProposals.status,
      createdAt: scheduleProposals.createdAt,
      createdByName: users.name,
      decidedAt: scheduleProposals.decidedAt,
      summary: scheduleProposals.summary,
      blocks: scheduleProposals.blocks,
    })
    .from(scheduleProposals)
    .leftJoin(users, eq(users.id, scheduleProposals.createdBy))
    .where(status ? eq(scheduleProposals.status, status as "proposed") : undefined)
    .orderBy(desc(scheduleProposals.createdAt))
    .limit(30);
  return ok({ proposals: rows });
});
