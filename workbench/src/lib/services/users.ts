import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export async function getOwnerId() {
  const [o] = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "owner"), eq(users.active, true))).orderBy(asc(users.id)).limit(1);
  return o?.id ?? null;
}
export async function listUsers() {
  return db.select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active, timezone: users.timezone }).from(users).orderBy(asc(users.id));
}
