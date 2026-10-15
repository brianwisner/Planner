import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { availabilityRules } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";

// Replace the weekly template for a user. Users edit their own hours; the owner can edit anyone's.
export const PUT = route(async (req) => {
  const user = await requireUser();
  await assertSameOrigin();
  const body = await parseBody(
    req,
    z.object({
      userId: z.number().int().optional(),
      rules: z.array(z.object({ weekday: z.number().int().min(1).max(7), startMinute: z.number().int().min(0).max(1440), endMinute: z.number().int().min(0).max(1440), breakMinutes: z.number().int().min(0).max(600) })),
    }),
  );
  const userId = body.userId ?? user.id;
  if (userId !== user.id && user.role !== "owner") throw new ApiError("You can only edit your own hours", 403);
  await db.transaction(async (tx) => {
    await tx.delete(availabilityRules).where(eq(availabilityRules.userId, userId));
    const valid = body.rules.filter((r) => r.endMinute > r.startMinute);
    if (valid.length) await tx.insert(availabilityRules).values(valid.map((r) => ({ ...r, userId })));
  });
  await audit(user.id, "availability.rules", "user", userId, `Updated weekly working hours`);
  return ok({ ok: true });
});
