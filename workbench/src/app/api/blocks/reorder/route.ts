import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { workBlocks } from "@/lib/db/schema";
import { assertSameOrigin, requireOwner } from "@/lib/auth/session";
import { ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";

export const POST = route(async (req) => {
  const user = await requireOwner();
  await assertSameOrigin();
  const { date, orderedIds } = await parseBody(req, z.object({ date: z.string(), orderedIds: z.array(z.number().int()) }));
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(workBlocks)
        .set({ sortOrder: i, version: sql`${workBlocks.version} + 1` })
        .where(and(eq(workBlocks.id, orderedIds[i]), inArray(workBlocks.id, orderedIds)));
    }
  });
  await audit(user.id, "block.reorder", "schedule", null, `Reordered work on ${date}`);
  return ok({ ok: true });
});
