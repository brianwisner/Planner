import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { billingRates } from "@/lib/db/schema";
import { assertSameOrigin, requireOwner, requireUser } from "@/lib/auth/session";
import { ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";

export const rateSchema = z.object({ name: z.string().min(1).max(100), rate: z.number().min(0), active: z.boolean().optional(), isDefault: z.boolean().optional() });

export const GET = route(async () => {
  await requireUser();
  return ok({ rates: await db.select().from(billingRates).orderBy(asc(billingRates.id)) });
});

export const POST = route(async (req) => {
  const user = await requireOwner();
  await assertSameOrigin();
  const body = await parseBody(req, rateSchema);
  if (body.isDefault) await db.update(billingRates).set({ isDefault: false }).where(eq(billingRates.isDefault, true));
  const [row] = await db.insert(billingRates).values({ ...body, rate: String(body.rate) }).returning();
  await audit(user.id, "rate.create", "rate", row.id, `Added billing rate ${row.name} $${row.rate}/h`);
  return ok({ rate: row }, { status: 201 });
});
