import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { billingRates, clients, estimateLines, estimates, projectItems, projectTypes, projects, timeEntries, users } from "@/lib/db/schema";
import { recommendEstimate, type CompletedProject } from "@/lib/engine/estimates";
import { num } from "@/lib/format";

export async function defaultRate() {
  const [r] = await db.select().from(billingRates).where(and(eq(billingRates.isDefault, true), eq(billingRates.active, true))).limit(1);
  return r ? num(r.rate) : 150;
}

export async function listEstimates(opts: { status?: string; projectId?: number } = {}) {
  const where = [];
  if (opts.status && opts.status !== "all") where.push(eq(estimates.status, opts.status as "draft"));
  if (opts.projectId) where.push(eq(estimates.projectId, opts.projectId));
  return db
    .select({
      id: estimates.id,
      projectId: estimates.projectId,
      projectName: projects.name,
      clientName: clients.name,
      revision: estimates.revision,
      scopeKind: estimates.scopeKind,
      status: estimates.status,
      feeType: estimates.feeType,
      totalHours: estimates.totalHours,
      totalFee: estimates.totalFee,
      title: estimates.title,
      preparedByName: users.name,
      createdAt: estimates.createdAt,
      submittedAt: estimates.submittedAt,
      approvedAt: estimates.approvedAt,
      version: estimates.version,
    })
    .from(estimates)
    .innerJoin(projects, eq(projects.id, estimates.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(users, eq(users.id, estimates.preparedBy))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(estimates.createdAt));
}

export async function getEstimateFull(id: number) {
  const [row] = await db
    .select({
      estimate: estimates,
      projectName: projects.name,
      projectAddress: projects.address,
      projectScope: projects.scope,
      projectTypeName: projectTypes.name,
      clientName: clients.name,
      clientCompany: clients.company,
      clientEmail: clients.email,
      clientAddress: clients.address,
      preparedByName: users.name,
    })
    .from(estimates)
    .innerJoin(projects, eq(projects.id, estimates.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(projectTypes, eq(projectTypes.id, projects.projectTypeId))
    .leftJoin(users, eq(users.id, estimates.preparedBy))
    .where(eq(estimates.id, id));
  if (!row) return null;
  const lines = await db.select().from(estimateLines).where(eq(estimateLines.estimateId, id)).orderBy(asc(estimateLines.sortOrder), asc(estimateLines.id));
  const approver = row.estimate.approvedBy ? (await db.select({ name: users.name }).from(users).where(eq(users.id, row.estimate.approvedBy)))[0]?.name : null;
  return { ...row.estimate, lines, projectName: row.projectName, projectAddress: row.projectAddress, projectScope: row.projectScope, projectTypeName: row.projectTypeName, clientName: row.clientName, clientCompany: row.clientCompany, clientEmail: row.clientEmail, clientAddress: row.clientAddress, preparedByName: row.preparedByName, approvedByName: approver };
}
export type EstimateFull = NonNullable<Awaited<ReturnType<typeof getEstimateFull>>>;

/** Completed projects with actual hours, original approved estimate hours, and added-scope hours. */
export async function completedHistory(): Promise<CompletedProject[]> {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectTypeId: projects.projectTypeId,
      complexity: projects.complexity,
      feeAmount: projects.feeAmount,
      feeType: projects.feeType,
      actualCompletion: projects.actualCompletion,
      actualMinutes: sql<number>`coalesce((select sum(t.duration_minutes)::int from ${timeEntries} t where t.project_id = ${projects}.id and (t.ended_at is not null or t.source = 'manual')), 0)`,
      scopeChangeHours: sql<number>`coalesce((select sum(i.hours_added)::float from ${projectItems} i where i.project_id = ${projects}.id and i.kind = 'scope_change'), 0)`,
      originalEstimatedHours: sql<number | null>`(select e.total_hours::float from ${estimates} e where e.project_id = ${projects}.id and e.scope_kind = 'original' and e.status = 'approved' order by e.approved_at desc limit 1)`,
    })
    .from(projects)
    .where(eq(projects.status, "completed"));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    projectTypeId: r.projectTypeId,
    complexity: r.complexity,
    originalEstimatedHours: r.originalEstimatedHours,
    actualHours: Math.round((r.actualMinutes / 60) * 100) / 100,
    scopeChangeHours: r.scopeChangeHours,
    feeAmount: r.feeAmount != null ? num(r.feeAmount) : null,
    feeType: r.feeType,
    actualCompletion: r.actualCompletion,
  }));
}

export async function recommendForProject(projectId: number) {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) return null;
  const [t] = p.projectTypeId ? await db.select().from(projectTypes).where(eq(projectTypes.id, p.projectTypeId)) : [];
  const history = await completedHistory();
  const rate = await defaultRate();
  return recommendEstimate(
    { projectTypeId: p.projectTypeId, complexity: p.complexity, typeName: t?.name },
    history,
    t ? { defaultHours: t.defaultHours != null ? num(t.defaultHours) : null, defaultFee: t.defaultFee != null ? num(t.defaultFee) : null, defaultFeeType: t.defaultFeeType } : null,
    rate,
  );
}

/** After an approval: project estimated hours/fee = approved original + approved added scope. */
export async function syncProjectFromApprovedEstimates(projectId: number) {
  const approved = await db.select().from(estimates).where(and(eq(estimates.projectId, projectId), eq(estimates.status, "approved")));
  if (!approved.length) return;
  const hours = approved.reduce((s, e) => s + num(e.totalHours), 0);
  const fee = approved.reduce((s, e) => s + num(e.totalFee), 0);
  const original = approved.find((e) => e.scopeKind === "original") ?? approved[0];
  await db
    .update(projects)
    .set({ estimatedHours: String(Math.round(hours * 100) / 100), feeAmount: String(Math.round(fee * 100) / 100), feeType: original.feeType, hourlyRate: original.hourlyRate, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}

export async function estimatesByIds(ids: number[]) {
  if (!ids.length) return [];
  return db.select().from(estimates).where(inArray(estimates.id, ids));
}
