import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, clients, contacts, correspondence, projects, users } from "@/lib/db/schema";

export async function listClients(opts: { q?: string; status?: string } = {}) {
  const where = [];
  if (opts.status && opts.status !== "all") where.push(eq(clients.status, opts.status as "active" | "archived"));
  if (opts.q) {
    const q = `%${opts.q}%`;
    where.push(or(ilike(clients.name, q), ilike(clients.company, q), ilike(clients.email, q))!);
  }
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      company: clients.company,
      email: clients.email,
      phone: clients.phone,
      kind: clients.kind,
      status: clients.status,
      updatedAt: clients.updatedAt,
      projectCount: sql<number>`(select count(*)::int from ${projects} p where p.client_id = ${clients}.id)`,
      activeProjects: sql<number>`(select count(*)::int from ${projects} p where p.client_id = ${clients}.id and p.status in ('accepted','in_progress'))`,
      lastActivity: sql<string | null>`(select max(c.occurred_at) from ${correspondence} c where c.client_id = ${clients}.id)`,
    })
    .from(clients)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(clients.name));
  return rows;
}

export async function getClientFull(id: number) {
  const [client] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  if (!client) return null;
  const [cts, projs, corr, history] = await Promise.all([
    db.select().from(contacts).where(eq(contacts.clientId, id)).orderBy(desc(contacts.isPrimary), asc(contacts.name)),
    db
      .select({
        id: projects.id,
        name: projects.name,
        status: projects.status,
        priority: projects.priority,
        address: projects.address,
        clientDueDate: projects.clientDueDate,
        targetCompletion: projects.targetCompletion,
        estimatedHours: projects.estimatedHours,
        feeAmount: projects.feeAmount,
        feeType: projects.feeType,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .where(eq(projects.clientId, id))
      .orderBy(desc(projects.updatedAt)),
    db
      .select({
        id: correspondence.id,
        kind: correspondence.kind,
        subject: correspondence.subject,
        body: correspondence.body,
        occurredAt: correspondence.occurredAt,
        linkUrl: correspondence.linkUrl,
        projectId: correspondence.projectId,
        projectName: projects.name,
        createdByName: users.name,
      })
      .from(correspondence)
      .leftJoin(projects, eq(projects.id, correspondence.projectId))
      .leftJoin(users, eq(users.id, correspondence.createdBy))
      .where(eq(correspondence.clientId, id))
      .orderBy(desc(correspondence.occurredAt))
      .limit(100),
    db
      .select({ id: auditLog.id, at: auditLog.at, action: auditLog.action, summary: auditLog.summary, userName: users.name })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .where(and(eq(auditLog.entityType, "client"), eq(auditLog.entityId, String(id))))
      .orderBy(desc(auditLog.at))
      .limit(50),
  ]);
  return { ...client, contacts: cts, projects: projs, correspondence: corr, history };
}
export type ClientFull = NonNullable<Awaited<ReturnType<typeof getClientFull>>>;
