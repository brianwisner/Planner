import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { correspondence, gmailMessages, googleAccounts } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, idParam, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";

// Links a message to a client/project by creating a correspondence record with a link back to Gmail.
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const body = await parseBody(req, z.object({ clientId: z.number().int().nullable().optional(), projectId: z.number().int().nullable().optional() }));
  if (!body.clientId && !body.projectId) throw new ApiError("Choose a client or project", 422);
  const [m] = await db.select({ m: gmailMessages }).from(gmailMessages).innerJoin(googleAccounts, eq(googleAccounts.id, gmailMessages.googleAccountId)).where(and(eq(gmailMessages.id, id), eq(googleAccounts.userId, user.id)));
  if (!m) throw new ApiError("Message not found", 404);
  const [c] = await db
    .insert(correspondence)
    .values({
      clientId: body.clientId ?? null,
      projectId: body.projectId ?? null,
      kind: "email",
      subject: m.m.subject,
      body: `From: ${m.m.fromName ? `${m.m.fromName} <${m.m.fromAddress}>` : m.m.fromAddress}\n\n${m.m.snippet ?? ""}`,
      occurredAt: m.m.receivedAt ?? new Date(),
      gmailMessageId: m.m.gmailMessageId,
      gmailThreadId: m.m.gmailThreadId,
      linkUrl: m.m.linkUrl,
      createdBy: user.id,
    })
    .returning();
  await db.update(gmailMessages).set({ status: "linked", linkedClientId: body.clientId ?? null, linkedProjectId: body.projectId ?? null }).where(eq(gmailMessages.id, id));
  await audit(user.id, "inbox.link", body.projectId ? "project" : "client", body.projectId ?? body.clientId!, `Linked email "${m.m.subject ?? ""}"`);
  return ok({ correspondence: c });
});
