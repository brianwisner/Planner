import { google } from "googleapis";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { googleAccounts } from "@/lib/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";

export const SCOPES = {
  base: ["openid", "https://www.googleapis.com/auth/userinfo.email"],
  calendar: ["https://www.googleapis.com/auth/calendar.readonly"],
  calendarWrite: ["https://www.googleapis.com/auth/calendar.events"],
  gmail: ["https://www.googleapis.com/auth/gmail.readonly"],
};

export function googleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.APP_URL);
}

export function redirectUri() {
  return `${process.env.APP_URL}/api/google/callback`;
}

export function newOAuthClient() {
  if (!googleConfigured()) throw new Error("Google integration is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and APP_URL.");
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri());
}

export async function getAccount(userId: number) {
  const [a] = await db.select().from(googleAccounts).where(eq(googleAccounts.userId, userId));
  return a ?? null;
}

export function hasScope(account: { scopes: string } | null, scope: string) {
  return !!account && account.scopes.split(" ").includes(scope);
}

/** Authorized client for a user. Refreshed access tokens are persisted automatically. */
export async function authorizedClient(userId: number) {
  const account = await getAccount(userId);
  if (!account || account.status === "disconnected" || !account.refreshTokenEnc) throw new Error("Google account is not connected");
  const client = newOAuthClient();
  client.setCredentials({
    access_token: account.accessTokenEnc ? decrypt(account.accessTokenEnc) : undefined,
    refresh_token: decrypt(account.refreshTokenEnc),
    expiry_date: account.tokenExpiresAt?.getTime(),
  });
  client.on("tokens", async (tokens) => {
    const set: Partial<typeof googleAccounts.$inferInsert> = { updatedAt: new Date() };
    if (tokens.access_token) set.accessTokenEnc = encrypt(tokens.access_token);
    if (tokens.refresh_token) set.refreshTokenEnc = encrypt(tokens.refresh_token);
    if (tokens.expiry_date) set.tokenExpiresAt = new Date(tokens.expiry_date);
    await db.update(googleAccounts).set(set).where(eq(googleAccounts.id, account.id));
  });
  return { client, account };
}

export async function recordError(accountId: number, field: "lastError" | "gmailLastError", message: string | null) {
  await db
    .update(googleAccounts)
    .set({ [field]: message, status: field === "lastError" && message ? "error" : undefined, updatedAt: new Date() })
    .where(eq(googleAccounts.id, accountId));
}

export function describeGoogleError(e: unknown): string {
  const err = e as { code?: number; message?: string; response?: { status?: number; data?: { error?: { message?: string } | string } } };
  const status = err.response?.status ?? err.code;
  const data = err.response?.data?.error;
  const detail = typeof data === "string" ? data : data?.message;
  if (status === 401 || detail === "invalid_grant") return "Google access was revoked or expired. Reconnect your Google account.";
  if (status === 403) return `Google denied the request (${detail ?? "insufficient permission"}). Reconnect and grant the requested access.`;
  if (status === 429) return "Google rate limit reached. Try again in a few minutes.";
  return detail ?? err.message ?? "Unknown Google error";
}
