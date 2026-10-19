import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { scenarios } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getOwnerId } from "@/lib/services/users";

export const overridesSchema = z.object({
  projects: z.record(z.string(), z.object({ priority: z.number().int().min(1).max(4).optional(), remainingHours: z.number().min(0).optional(), clientDueDate: z.string().nullable().optional(), include: z.boolean().optional(), status: z.string().optional() })).optional(),
  capacity: z.object({ bufferPercent: z.number().int().min(0).max(90).optional(), maxConcurrentProjects: z.number().int().min(1).max(10).optional(), extraHoursPerDay: z.number().min(-12).max(12).optional() }).optional(),
  horizonDays: z.number().int().min(7).max(180).optional(),
});

export const GET = route(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const userId = Number(url.searchParams.get("userId") ?? (await getOwnerId()) ?? user.id);
  return ok({ scenarios: await db.select().from(scenarios).where(eq(scenarios.userId, userId)).orderBy(desc(scenarios.updatedAt)) });
});

export const POST = route(async (req) => {
  const user = await requireUser();
  await assertSameOrigin();
  const body = await parseBody(req, z.object({ userId: z.number().int().optional(), name: z.string().min(1).max(200), overrides: overridesSchema.optional() }));
  const [row] = await db.insert(scenarios).values({ userId: body.userId ?? (await getOwnerId()) ?? user.id, name: body.name, overrides: body.overrides ?? {}, createdBy: user.id }).returning();
  await audit(user.id, "scenario.create", "scenario", row.id, `Created what-if scenario "${row.name}"`);
  return ok({ scenario: row }, { status: 201 });
});
