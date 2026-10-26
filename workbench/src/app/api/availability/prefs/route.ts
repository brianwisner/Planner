import { z } from "zod";
import { db } from "@/lib/db";
import { schedulingPrefs } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";

export const PUT = route(async (req) => {
  const user = await requireUser();
  await assertSameOrigin();
  const body = await parseBody(
    req,
    z.object({
      userId: z.number().int().optional(),
      bufferPercent: z.number().int().min(0).max(90).optional(),
      maxConcurrentProjects: z.number().int().min(1).max(10).optional(),
      minBlockHours: z.number().min(0.25).max(8).optional(),
      horizonDays: z.number().int().min(7).max(180).optional(),
      timezone: z.string().max(64).optional(),
    }),
  );
  const userId = body.userId ?? user.id;
  if (userId !== user.id && user.role !== "owner") throw new ApiError("You can only edit your own preferences", 403);
  const { userId: _u, minBlockHours, ...rest } = body;
  const set = { ...rest, ...(minBlockHours != null ? { minBlockHours: String(minBlockHours) } : {}) };
  const [row] = await db
    .insert(schedulingPrefs)
    .values({ userId, ...set })
    .onConflictDoUpdate({ target: schedulingPrefs.userId, set })
    .returning();
  await audit(user.id, "availability.prefs", "user", userId, `Updated scheduling preferences`);
  return ok({ prefs: row });
});
