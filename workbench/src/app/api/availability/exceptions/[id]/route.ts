import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { availabilityExceptions } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, idParam, ok, route } from "@/lib/api";
import { audit } from "@/lib/audit";

export const DELETE = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const [row] = await db.select().from(availabilityExceptions).where(eq(availabilityExceptions.id, id));
  if (!row) throw new ApiError("Not found", 404);
  if (row.userId !== user.id && user.role !== "owner") throw new ApiError("You can only edit your own hours", 403);
  await db.delete(availabilityExceptions).where(eq(availabilityExceptions.id, id));
  await audit(user.id, "availability.exception.delete", "user", row.userId, `Removed exception on ${row.date}`);
  return ok({ ok: true });
});
