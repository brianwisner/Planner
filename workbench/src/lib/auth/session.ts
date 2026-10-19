import { cookies, headers } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { cache } from "react";

export const SESSION_COOKIE = "wb_session";
const SESSION_DAYS = 30;

export type SessionUser = {
  id: number;
  email: string;
  name: string;
  role: "owner" | "staff";
  timezone: string;
};

function hashToken(token: string) {
  return createHash("sha256").update(token + (process.env.SESSION_SECRET ?? "")).digest("hex");
}

export async function createSession(userId: number, userAgent?: string | null) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt, userAgent: userAgent ?? null });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  jar.delete(SESSION_COOKIE);
}

/** Returns the signed-in user or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      timezone: users.timezone,
      active: users.active,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const u = rows[0];
  if (!u || !u.active) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role, timezone: u.timezone };
});

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) throw new AuthError("Sign in required", 401);
  return u;
}

export async function requireOwner(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== "owner") throw new AuthError("Only the owner can do this", 403);
  return u;
}

/** Basic CSRF protection for mutating requests: Origin must match the app host. */
export async function assertSameOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  if (!origin) return; // non-browser or same-origin form posts without Origin
  const host = h.get("x-forwarded-host") ?? h.get("host");
  try {
    if (new URL(origin).host !== host) throw new AuthError("Cross-site request blocked", 403);
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new AuthError("Cross-site request blocked", 403);
  }
}
