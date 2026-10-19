import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { ApiError, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";

// Simple in-memory throttle: 10 failed attempts per email per 15 minutes.
const attempts = new Map<string, { n: number; until: number }>();

export const POST = route(async (req) => {
  const body = await parseBody(req, z.object({ email: z.string().email(), password: z.string().min(1) }));
  const email = body.email.toLowerCase().trim();
  const a = attempts.get(email);
  if (a && a.n >= 10 && a.until > Date.now()) throw new ApiError("Too many attempts. Try again in a few minutes.", 429);
  const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const valid = u && u.active && (await verifyPassword(body.password, u.passwordHash));
  if (!valid) {
    const cur = attempts.get(email) ?? { n: 0, until: 0 };
    attempts.set(email, { n: cur.n + 1, until: Date.now() + 15 * 60_000 });
    throw new ApiError("Email or password is incorrect.", 401);
  }
  attempts.delete(email);
  await createSession(u.id, req.headers.get("user-agent"));
  await audit(u.id, "auth.login", "user", u.id, `${u.name} signed in`);
  return ok({ id: u.id, name: u.name, role: u.role });
});
