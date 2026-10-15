import { and, desc, eq, gte, isNull, isNotNull, lte, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/lib/db";
import { clients, projects, tasks, timeEntries, users } from "@/lib/db/schema";

export async function getRunningTimer(userId: number) {
  const [row] = await db
    .select({
      id: timeEntries.id,
      projectId: timeEntries.projectId,
      projectName: projects.name,
      clientName: clients.name,
      taskId: timeEntries.taskId,
      taskName: tasks.name,
      startedAt: timeEntries.startedAt,
      notes: timeEntries.notes,
      billable: timeEntries.billable,
      version: timeEntries.version,
    })
    .from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.endedAt), isNotNull(timeEntries.startedAt)))
    .limit(1);
  return row ?? null;
}

/** Stops the user's running timer, if any. Duration is computed from server timestamps. */
export async function stopRunningTimer(userId: number, notes?: string | null) {
  const now = new Date();
  const [row] = await db
    .update(timeEntries)
    .set({
      endedAt: now,
      durationMinutes: sql`greatest(1, round(extract(epoch from (${now.toISOString()}::timestamptz - ${timeEntries.startedAt})) / 60))::int`,
      notes: notes !== undefined && notes !== null ? notes : sql`${timeEntries.notes}`,
      version: sql`${timeEntries.version} + 1`,
      updatedAt: now,
    })
    .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.endedAt), isNotNull(timeEntries.startedAt)))
    .returning();
  return row ?? null;
}

export async function startTimer(userId: number, tz: string, input: { projectId: number; taskId?: number | null; notes?: string | null; billable?: boolean }) {
  const now = new Date();
  const entryDate = DateTime.fromJSDate(now).setZone(tz).toISODate()!;
  const [row] = await db
    .insert(timeEntries)
    .values({
      userId,
      projectId: input.projectId,
      taskId: input.taskId ?? null,
      entryDate,
      startedAt: now,
      endedAt: null,
      durationMinutes: 0,
      notes: input.notes ?? null,
      billable: input.billable ?? true,
      source: "timer",
    })
    .returning();
  return row;
}

export async function listTimeEntries(opts: { userId?: number; from: string; to: string; projectId?: number }) {
  const where = [gte(timeEntries.entryDate, opts.from), lte(timeEntries.entryDate, opts.to)];
  if (opts.userId) where.push(eq(timeEntries.userId, opts.userId));
  if (opts.projectId) where.push(eq(timeEntries.projectId, opts.projectId));
  return db
    .select({
      id: timeEntries.id,
      userId: timeEntries.userId,
      userName: users.name,
      projectId: timeEntries.projectId,
      projectName: projects.name,
      clientName: clients.name,
      taskId: timeEntries.taskId,
      taskName: tasks.name,
      entryDate: timeEntries.entryDate,
      startedAt: timeEntries.startedAt,
      endedAt: timeEntries.endedAt,
      durationMinutes: timeEntries.durationMinutes,
      notes: timeEntries.notes,
      billable: timeEntries.billable,
      source: timeEntries.source,
      version: timeEntries.version,
    })
    .from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(users, eq(users.id, timeEntries.userId))
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .where(and(...where))
    .orderBy(desc(timeEntries.entryDate), desc(timeEntries.id));
}
