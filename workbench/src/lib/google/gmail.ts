import { google } from "googleapis";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, contacts, gmailMessages, googleAccounts, projects } from "@/lib/db/schema";
import { authorizedClient, describeGoogleError, recordError } from "./client";
import { matchMessage } from "@/lib/engine/gmailMatch";

function header(headers: { name?: string | null; value?: string | null }[] | undefined, name: string) {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}
function parseFrom(v: string | null) {
  if (!v) return { name: null, address: null };
  const m = /^(.*?)\s*<([^>]+)>$/.exec(v.trim());
  if (m) return { name: m[1].replace(/^"|"$/g, "").trim() || null, address: m[2].trim().toLowerCase() };
  return { name: null, address: v.trim().toLowerCase() };
}

/** Pulls recent inbox message metadata (read-only) and stores suggestions. Never modifies mail. */
export async function scanGmail(userId: number, opts: { days?: number; max?: number } = {}) {
  const { client, account } = await authorizedClient(userId);
  const gmail = google.gmail({ version: "v1", auth: client });
  const days = opts.days ?? 14;
  const max = opts.max ?? 60;
  try {
    const list = await gmail.users.messages.list({ userId: "me", maxResults: max, q: `newer_than:${days}d -in:spam -in:trash -category:promotions -category:social -category:updates` });
    const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);
    const known = new Set((await db.select({ id: gmailMessages.gmailMessageId }).from(gmailMessages).where(eq(gmailMessages.googleAccountId, account.id))).map((r) => r.id));
    const fresh = ids.filter((id) => !known.has(id));
    const [cl, ct, pr] = await Promise.all([db.select().from(clients).where(eq(clients.status, "active")), db.select().from(contacts), db.select({ id: projects.id, clientId: projects.clientId, name: projects.name, address: projects.address }).from(projects)]);
    const matchClients = cl.map((c) => ({ id: c.id, name: c.name, company: c.company, email: c.email, contactEmails: ct.filter((x) => x.clientId === c.id).map((x) => x.email).filter((e): e is string => !!e) }));
    let stored = 0;
    for (const id of fresh) {
      const m = await gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["From", "To", "Subject", "Date"] });
      const h = m.data.payload?.headers ?? [];
      const from = parseFrom(header(h, "From"));
      if (from.address && account.googleEmail && from.address === account.googleEmail.toLowerCase()) continue; // skip own sent mail
      const msg = { fromAddress: from.address, fromName: from.name, subject: header(h, "Subject"), snippet: m.data.snippet ?? null };
      const match = matchMessage(msg, matchClients, pr);
      await db
        .insert(gmailMessages)
        .values({
          googleAccountId: account.id,
          gmailMessageId: id,
          gmailThreadId: m.data.threadId ?? null,
          fromAddress: from.address,
          fromName: from.name,
          toAddress: header(h, "To"),
          subject: msg.subject,
          snippet: msg.snippet,
          receivedAt: m.data.internalDate ? new Date(Number(m.data.internalDate)) : null,
          linkUrl: `https://mail.google.com/mail/u/0/#all/${id}`,
          suggestedClientId: match.clientId,
          suggestedProjectId: match.projectId,
          matchReason: match.reasons.join("; ") || null,
          relevanceScore: match.score,
          status: "new",
        })
        .onConflictDoNothing();
      stored++;
    }
    await db.update(googleAccounts).set({ gmailLastScanAt: new Date(), gmailLastError: null, updatedAt: new Date() }).where(eq(googleAccounts.id, account.id));
    return { scanned: ids.length, stored };
  } catch (e) {
    const msg = describeGoogleError(e);
    await recordError(account.id, "gmailLastError", msg);
    throw new Error(msg);
  }
}

/** Plain-text body of one message for prefilling a draft record. Returned as text only; never interpreted. */
export async function getMessageText(userId: number, gmailMessageId: string) {
  const { client } = await authorizedClient(userId);
  const gmail = google.gmail({ version: "v1", auth: client });
  const m = await gmail.users.messages.get({ userId: "me", id: gmailMessageId, format: "full" });
  const parts: string[] = [];
  const walk = (p: { mimeType?: string | null; body?: { data?: string | null } | null; parts?: unknown[] } | undefined) => {
    if (!p) return;
    if (p.mimeType === "text/plain" && p.body?.data) parts.push(Buffer.from(p.body.data, "base64url").toString("utf8"));
    for (const c of (p.parts ?? []) as typeof p[]) walk(c);
  };
  walk(m.data.payload as Parameters<typeof walk>[0]);
  let text = parts.join("\n").trim();
  if (!text && m.data.payload?.body?.data) text = Buffer.from(m.data.payload.body.data, "base64url").toString("utf8").replace(/<[^>]+>/g, " ");
  return text.slice(0, 20000);
}
