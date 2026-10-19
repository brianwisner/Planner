import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";

export async function audit(
  userId: number | null,
  action: string,
  entityType: string,
  entityId: string | number | null,
  summary: string,
  details?: unknown,
) {
  await db.insert(auditLog).values({
    userId,
    action,
    entityType,
    entityId: entityId == null ? null : String(entityId),
    summary,
    details: details ?? null,
  });
}
