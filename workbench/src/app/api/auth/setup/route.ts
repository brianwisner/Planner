import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { ApiError, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { seedDefaults } from "@/lib/seed";

// One-time setup: creates the owner account when no users exist.
export const POST = route(async (req) => {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  if (count > 0) throw new ApiError("Setup already completed.", 403);
  const body = await parseBody(
    req,
    z.object({ name: z.string().min(1).max(100), email: z.string().email(), password: z.string() }),
  );
  const weak = validatePasswordStrength(body.password);
  if (weak) throw new ApiError(weak, 422);
  const [u] = await db
    .insert(users)
    .values({ name: body.name.trim(), email: body.email.toLowerCase().trim(), role: "owner", passwordHash: await hashPassword(body.password) })
    .returning();
  await seedDefaults(u.id);
  await createSession(u.id, req.headers.get("user-agent"));
  await audit(u.id, "setup.complete", "user", u.id, `Owner account created for ${u.name}`);
  return ok({ id: u.id });
});
