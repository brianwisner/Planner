import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { billingRates } from "@/lib/db/schema";
import { assertSameOrigin, requireOwner } from "@/lib/auth/session";
import { ApiError, idParam, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { rateSchema } from "../route";

export const PATCH = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireOwner();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const body = await parseBody(req, rateSchema.partial());
  if (body.isDefault) await db.update(billingRates).set({ isDefault: false }).where(eq(billingRates.isDefault, true));
  const [row] = await db.update(billingRates).set({ ...body, rate: body.rate != null ? String(body.rate) : undefined }).where(eq(billingRates.id, id)).returning();
  if (!row) throw new ApiError("Rate not found", 404);
  await audit(user.id, "rate.update", "rate", id, `Updated billing rate ${row.name} $${row.rate}/h`);
  return ok({ rate: row });
});
