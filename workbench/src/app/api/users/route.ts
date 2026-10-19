import { z } from "zod";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { assertSameOrigin, requireOwner, requireUser } from "@/lib/auth/session";
import { ApiError, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";

export const GET = route(async () => {
  await requireUser();
  const rows = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active, timezone: users.timezone, createdAt: users.createdAt }).from(users).orderBy(asc(users.id));
  return ok({ users: rows });
});

export const POST = route(async (req) => {
  const owner = await requireOwner();
  await assertSameOrigin();
  const body = await parseBody(req, z.object({ name: z.string().min(1).max(100), email: z.string().email(), password: z.string(), role: z.enum(["owner", "staff"]).default("staff") }));
  const weak = validatePasswordStrength(body.password);
  if (weak) throw new ApiError(weak, 422);
  const [row] = await db
    .insert(users)
    .values({ name: body.name.trim(), email: body.email.toLowerCase().trim(), role: body.role, passwordHash: await hashPassword(body.password) })
    .returning({ id: users.id, name: users.name, email: users.email, role: users.role });
  await audit(owner.id, "user.create", "user", row.id, `Created user ${row.name} (${row.role})`);
  return ok({ user: row }, { status: 201 });
});
