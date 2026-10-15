import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/session";
import { ApiError, route } from "@/lib/api";
import { SCOPES, googleConfigured, newOAuthClient, getAccount } from "@/lib/google/client";

// Starts the OAuth flow. feature=calendar|gmail|writeback. Previously granted scopes are kept (incremental auth).
export const GET = route(async (req) => {
  const user = await requireUser();
  if (!googleConfigured()) throw new ApiError("Google integration is not configured on the server yet.", 503);
  const feature = new URL(req.url).searchParams.get("feature") ?? "calendar";
  const scopes = [...SCOPES.base, ...(feature === "gmail" ? SCOPES.gmail : feature === "writeback" ? SCOPES.calendar.concat(SCOPES.calendarWrite) : SCOPES.calendar)];
  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("wb_oauth_state", `${state}:${user.id}:${feature}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  const existing = await getAccount(user.id);
  const client = newOAuthClient();
  const url = client.generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    prompt: existing?.refreshTokenEnc ? "consent" : "consent",
    scope: scopes,
    state,
    login_hint: existing?.googleEmail ?? undefined,
  });
  return NextResponse.redirect(url);
});
