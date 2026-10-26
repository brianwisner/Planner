import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, users } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { ok, route } from "@/lib/api";

export const GET = route(async (req) => {
  await requireUser();
  const url = new URL(req.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 100));
  const where = [];
  if (entityType) where.push(eq(auditLog.entityType, entityType));
  if (entityId) where.push(eq(auditLog.entityId, entityId));
  const rows = await db
    .select({ id: auditLog.id, at: auditLog.at, action: auditLog.action, entityType: auditLog.entityType, entityId: auditLog.entityId, summary: auditLog.summary, details: auditLog.details, userName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(auditLog.at))
    .limit(limit);
  return ok({ entries: rows });
});
