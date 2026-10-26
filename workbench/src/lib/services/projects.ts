import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLog,
  clients,
  correspondence,
  estimates,
  projectDependencies,
  projectItems,
  projectTypes,
  projects,
  tasks,
  timeEntries,
  users,
  workBlocks,
  COMMITTED_STATUSES,
} from "@/lib/db/schema";
import { num } from "@/lib/format";

/** Hours remaining: explicit value if set, otherwise estimated minus actual (never below zero). */
export function deriveRemaining(p: { estimatedHours: string | null; remainingHours: string | null }, actualHours: number) {
  if (p.remainingHours != null) return num(p.remainingHours);
  if (p.estimatedHours == null) return 0;
  return Math.max(0, num(p.estimatedHours) - actualHours);
}

export type ProjectListRow = Awaited<ReturnType<typeof listProjects>>[number];

export async function listProjects(opts: { status?: string[]; clientId?: number; q?: string } = {}) {
  const where = [];
  if (opts.status?.length) where.push(inArray(projects.status, opts.status as (typeof projects.status.enumValues)[number][]));
  if (opts.clientId) where.push(eq(projects.clientId, opts.clientId));
  if (opts.q) where.push(sql`(${projects.name} ilike ${"%" + opts.q + "%"} or ${projects.address} ilike ${"%" + opts.q + "%"} or ${clients.name} ilike ${"%" + opts.q + "%"})`);
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      address: projects.address,
      clientId: projects.clientId,
      clientName: clients.name,
      projectTypeId: projects.projectTypeId,
      projectTypeName: projectTypes.name,
      status: projects.status,
      priority: projects.priority,
      tentativeReserve: projects.tentativeReserve,
      inquiryDate: projects.inquiryDate,
      acceptanceDate: projects.acceptanceDate,
      plannedStart: projects.plannedStart,
      actualStart: projects.actualStart,
      targetCompletion: projects.targetCompletion,
      clientDueDate: projects.clientDueDate,
      actualCompletion: projects.actualCompletion,
      estimatedHours: projects.estimatedHours,
      remainingHours: projects.remainingHours,
      feeType: projects.feeType,
      feeAmount: projects.feeAmount,
      updatedAt: projects.updatedAt,
      version: projects.version,
      actualMinutes: sql<number>`coalesce((select sum(t.duration_minutes)::int from ${timeEntries} t where t.project_id = ${projects}.id and t.ended_at is not null or (t.project_id = ${projects}.id and t.source = 'manual')), 0)`,
      openBlockers: sql<number>`(select count(*)::int from ${projectItems} i where i.project_id = ${projects}.id and i.status = 'open' and i.kind = 'blocker')`,
      openWaiting: sql<number>`(select count(*)::int from ${projectItems} i where i.project_id = ${projects}.id and i.status = 'open' and i.kind = 'waiting')`,
      blocksScheduling: sql<boolean>`exists(select 1 from ${projectItems} i where i.project_id = ${projects}.id and i.status = 'open' and i.blocks_scheduling)`,
      pendingEstimates: sql<number>`(select count(*)::int from ${estimates} e where e.project_id = ${projects}.id and e.status = 'submitted')`,
      scheduledHours: sql<number>`coalesce((select sum(b.hours)::float from ${workBlocks} b where b.project_id = ${projects}.id and b.date >= current_date), 0)`,
      lastScheduledDate: sql<string | null>`(select max(b.date)::text from ${workBlocks} b where b.project_id = ${projects}.id)`,
    })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(projectTypes, eq(projectTypes.id, projects.projectTypeId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(projects.priority), asc(projects.clientDueDate), desc(projects.updatedAt));
  return rows.map((r) => {
    const actualHours = Math.round((r.actualMinutes / 60) * 100) / 100;
    return {
      ...r,
      actualHours,
      remaining: deriveRemaining(r, actualHours),
      committed: COMMITTED_STATUSES.includes(r.status),
    };
  });
}

export async function getProjectFull(id: number) {
  const [p] = await db
    .select({ project: projects, clientName: clients.name, projectTypeName: projectTypes.name })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(projectTypes, eq(projectTypes.id, projects.projectTypeId))
    .where(eq(projects.id, id))
    .limit(1);
  if (!p) return null;
  const [taskRows, items, deps, ests, time, blocks, corr, history] = await Promise.all([
    db.select().from(tasks).where(eq(tasks.projectId, id)).orderBy(asc(tasks.sortOrder), asc(tasks.id)),
    db
      .select({ item: projectItems, createdByName: users.name })
      .from(projectItems)
      .leftJoin(users, eq(users.id, projectItems.createdBy))
      .where(eq(projectItems.projectId, id))
      .orderBy(desc(projectItems.createdAt)),
    db
      .select({ dependsOnId: projectDependencies.dependsOnId, name: projects.name, status: projects.status })
      .from(projectDependencies)
      .innerJoin(projects, eq(projects.id, projectDependencies.dependsOnId))
      .where(eq(projectDependencies.projectId, id)),
    db.select().from(estimates).where(eq(estimates.projectId, id)).orderBy(desc(estimates.createdAt)),
    db
      .select({
        id: timeEntries.id,
        entryDate: timeEntries.entryDate,
        durationMinutes: timeEntries.durationMinutes,
        notes: timeEntries.notes,
        billable: timeEntries.billable,
        taskId: timeEntries.taskId,
        userName: users.name,
        endedAt: timeEntries.endedAt,
        startedAt: timeEntries.startedAt,
        source: timeEntries.source,
      })
      .from(timeEntries)
      .leftJoin(users, eq(users.id, timeEntries.userId))
      .where(eq(timeEntries.projectId, id))
      .orderBy(desc(timeEntries.entryDate), desc(timeEntries.id))
      .limit(200),
    db.select().from(workBlocks).where(eq(workBlocks.projectId, id)).orderBy(asc(workBlocks.date)),
    db
      .select({
        id: correspondence.id,
        kind: correspondence.kind,
        subject: correspondence.subject,
        body: correspondence.body,
        occurredAt: correspondence.occurredAt,
        linkUrl: correspondence.linkUrl,
        createdByName: users.name,
      })
      .from(correspondence)
      .leftJoin(users, eq(users.id, correspondence.createdBy))
      .where(eq(correspondence.projectId, id))
      .orderBy(desc(correspondence.occurredAt))
      .limit(100),
    db
      .select({ id: auditLog.id, at: auditLog.at, action: auditLog.action, summary: auditLog.summary, userName: users.name })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .where(and(eq(auditLog.entityType, "project"), eq(auditLog.entityId, String(id))))
      .orderBy(desc(auditLog.at))
      .limit(100),
  ]);
  const actualMinutes = time.filter((t) => t.source === "manual" || t.endedAt).reduce((s, t) => s + t.durationMinutes, 0);
  const actualHours = Math.round((actualMinutes / 60) * 100) / 100;
  const futureScheduled = blocks.filter((b) => b.date >= new Date().toISOString().slice(0, 10)).reduce((s, b) => s + num(b.hours), 0);
  return {
    ...p.project,
    clientName: p.clientName,
    projectTypeName: p.projectTypeName,
    tasks: taskRows,
    items: items.map((i) => ({ ...i.item, createdByName: i.createdByName })),
    dependencies: deps,
    estimates: ests,
    timeEntries: time,
    workBlocks: blocks,
    correspondence: corr,
    history,
    actualHours,
    remaining: deriveRemaining(p.project, actualHours),
    scheduledHours: futureScheduled,
  };
}
export type ProjectFull = NonNullable<Awaited<ReturnType<typeof getProjectFull>>>;
