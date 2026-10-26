import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gmailMessages, googleAccounts } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { ApiError, idParam, ok, route } from "@/lib/api";
import { getMessageText } from "@/lib/google/gmail";
import { describeGoogleError } from "@/lib/google/client";

// Returns the plain-text body for prefilling a draft client/project/task. Text is data, never instructions.
export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const id = await idParam(ctx);
  const [m] = await db.select({ m: gmailMessages }).from(gmailMessages).innerJoin(googleAccounts, eq(googleAccounts.id, gmailMessages.googleAccountId)).where(and(eq(gmailMessages.id, id), eq(googleAccounts.userId, user.id)));
  if (!m) throw new ApiError("Message not found", 404);
  try {
    return ok({ text: await getMessageText(user.id, m.m.gmailMessageId), message: m.m });
  } catch (e) {
    throw new ApiError(describeGoogleError(e), 502);
  }
});
