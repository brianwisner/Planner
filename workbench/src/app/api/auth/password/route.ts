import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth/password";

export const POST = route(async (req) => {
  const user = await requireUser();
  await assertSameOrigin();
  const body = await parseBody(req, z.object({ current: z.string(), password: z.string() }));
  const [u] = await db.select().from(users).where(eq(users.id, user.id));
  if (!(await verifyPassword(body.current, u.passwordHash))) throw new ApiError("Current password is incorrect", 401);
  const weak = validatePasswordStrength(body.password);
  if (weak) throw new ApiError(weak, 422);
  await db.update(users).set({ passwordHash: await hashPassword(body.password) }).where(eq(users.id, user.id));
  await audit(user.id, "auth.password", "user", user.id, `${user.name} changed their password`);
  return ok({ ok: true });
});
