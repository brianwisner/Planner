import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, gmailMessages, googleAccounts, projects } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { ok, route } from "@/lib/api";

export const GET = route(async (req) => {
  const user = await requireUser();
  const status = new URL(req.url).searchParams.get("status") ?? "new";
  const rows = await db
    .select({
      id: gmailMessages.id,
      gmailMessageId: gmailMessages.gmailMessageId,
      fromAddress: gmailMessages.fromAddress,
      fromName: gmailMessages.fromName,
      subject: gmailMessages.subject,
      snippet: gmailMessages.snippet,
      receivedAt: gmailMessages.receivedAt,
      linkUrl: gmailMessages.linkUrl,
      suggestedClientId: gmailMessages.suggestedClientId,
      suggestedClientName: clients.name,
      suggestedProjectId: gmailMessages.suggestedProjectId,
      suggestedProjectName: projects.name,
      matchReason: gmailMessages.matchReason,
      relevanceScore: gmailMessages.relevanceScore,
      status: gmailMessages.status,
      linkedClientId: gmailMessages.linkedClientId,
      linkedProjectId: gmailMessages.linkedProjectId,
    })
    .from(gmailMessages)
    .innerJoin(googleAccounts, eq(googleAccounts.id, gmailMessages.googleAccountId))
    .leftJoin(clients, eq(clients.id, gmailMessages.suggestedClientId))
    .leftJoin(projects, eq(projects.id, gmailMessages.suggestedProjectId))
    .where(and(eq(googleAccounts.userId, user.id), status === "all" ? undefined : eq(gmailMessages.status, status as "new")))
    .orderBy(desc(gmailMessages.relevanceScore), desc(gmailMessages.receivedAt))
    .limit(200);
  return ok({ messages: rows });
});
