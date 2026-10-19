import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { google } from "googleapis";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { googleAccounts } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { route } from "@/lib/api";
import { newOAuthClient } from "@/lib/google/client";
import { encrypt } from "@/lib/crypto";
import { audit } from "@/lib/audit";

export const GET = route(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const jar = await cookies();
  const saved = jar.get("wb_oauth_state")?.value;
  jar.delete("wb_oauth_state");
  const back = (msg: string, okFlag = false) => NextResponse.redirect(new URL(`/settings/google?${okFlag ? "ok" : "error"}=${encodeURIComponent(msg)}`, process.env.APP_URL));
  if (error) return back(`Google returned: ${error}`);
  if (!code || !state || !saved) return back("Missing authorization code or state.");
  const [savedState, savedUser, feature] = saved.split(":");
  if (savedState !== state || Number(savedUser) !== user.id) return back("State mismatch. Please try connecting again.");
  const client = newOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const me = await oauth2.userinfo.get();
  const grantedScopes = (tokens.scope ?? "").split(" ").filter(Boolean);
  const [existing] = await db.select().from(googleAccounts).where(eq(googleAccounts.userId, user.id));
  const mergedScopes = Array.from(new Set([...(existing?.scopes.split(" ").filter(Boolean) ?? []), ...grantedScopes])).join(" ");
  const values = {
    userId: user.id,
    googleEmail: me.data.email ?? existing?.googleEmail ?? null,
    accessTokenEnc: tokens.access_token ? encrypt(tokens.access_token) : existing?.accessTokenEnc ?? null,
    refreshTokenEnc: tokens.refresh_token ? encrypt(tokens.refresh_token) : existing?.refreshTokenEnc ?? null,
    tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scopes: mergedScopes,
    status: "connected" as const,
    lastError: null,
    updatedAt: new Date(),
  };
  if (!values.refreshTokenEnc) return back("Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.");
  await db.insert(googleAccounts).values(values).onConflictDoUpdate({ target: googleAccounts.userId, set: values });
  await audit(user.id, "google.connect", "user", user.id, `Connected Google account ${values.googleEmail} (${feature})`, { scopes: grantedScopes });
  return back(`Google account ${values.googleEmail} connected.`, true);
});
