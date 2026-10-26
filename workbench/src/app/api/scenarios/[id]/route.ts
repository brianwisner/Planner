import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { scenarios } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, idParam, ok, parseBody, route } from "@/lib/api";
import { overridesSchema } from "../route";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req, ctx: Ctx) => {
  await requireUser();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const body = await parseBody(req, z.object({ name: z.string().min(1).max(200).optional(), overrides: overridesSchema.optional() }));
  const [row] = await db.update(scenarios).set({ ...body, updatedAt: new Date() }).where(eq(scenarios.id, id)).returning();
  if (!row) throw new ApiError("Scenario not found", 404);
  return ok({ scenario: row });
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  await requireUser();
  await assertSameOrigin();
  const id = await idParam(ctx);
  await db.delete(scenarios).where(eq(scenarios.id, id));
  return ok({ ok: true });
});
