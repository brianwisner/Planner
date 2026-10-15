import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gmailMessages, googleAccounts } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, idParam, ok, route } from "@/lib/api";

export const POST = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const [m] = await db.select({ id: gmailMessages.id }).from(gmailMessages).innerJoin(googleAccounts, eq(googleAccounts.id, gmailMessages.googleAccountId)).where(and(eq(gmailMessages.id, id), eq(googleAccounts.userId, user.id)));
  if (!m) throw new ApiError("Message not found", 404);
  await db.update(gmailMessages).set({ status: "dismissed" }).where(eq(gmailMessages.id, id));
  return ok({ ok: true });
});
