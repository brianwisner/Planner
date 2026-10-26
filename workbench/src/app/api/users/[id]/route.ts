import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { assertSameOrigin, requireOwner } from "@/lib/auth/session";
import { ApiError, idParam, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";

export const PATCH = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const owner = await requireOwner();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const body = await parseBody(req, z.object({ name: z.string().min(1).max(100).optional(), email: z.string().email().optional(), active: z.boolean().optional(), role: z.enum(["owner", "staff"]).optional(), password: z.string().optional(), timezone: z.string().max(64).optional() }));
  if (id === owner.id && (body.active === false || body.role === "staff")) throw new ApiError("You cannot deactivate or demote your own account", 422);
  const set: Record<string, unknown> = { ...body };
  delete set.password;
  if (body.password) {
    const weak = validatePasswordStrength(body.password);
    if (weak) throw new ApiError(weak, 422);
    set.passwordHash = await hashPassword(body.password);
  }
  if (body.email) set.email = body.email.toLowerCase().trim();
  const [row] = await db.update(users).set(set).where(eq(users.id, id)).returning({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active });
  if (!row) throw new ApiError("User not found", 404);
  await audit(owner.id, "user.update", "user", id, `Updated user ${row.name}${body.password ? " (password reset)" : ""}${body.active === false ? " (deactivated)" : ""}`);
  return ok({ user: row });
});
