import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, contacts, correspondence, estimateLines, estimates, projectItems, projects, tasks, timeEntries, users, workBlocks, auditLog } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { ApiError, route } from "@/lib/api";
import { audit } from "@/lib/audit";

function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

// GET /api/export?what=clients|projects|time|estimates|all&format=csv|json
export const GET = route(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const what = url.searchParams.get("what") ?? "all";
  const format = url.searchParams.get("format") ?? (what === "all" ? "json" : "csv");
  const stamp = new Date().toISOString().slice(0, 10);
  let rows: Record<string, unknown>[] = [];
  const name = what;
  if (what === "clients") {
    rows = await db.select().from(clients).orderBy(asc(clients.id));
  } else if (what === "projects") {
    rows = await db
      .select({ id: projects.id, name: projects.name, client: clients.name, address: projects.address, status: projects.status, priority: projects.priority, inquiryDate: projects.inquiryDate, acceptanceDate: projects.acceptanceDate, plannedStart: projects.plannedStart, actualStart: projects.actualStart, targetCompletion: projects.targetCompletion, clientDueDate: projects.clientDueDate, actualCompletion: projects.actualCompletion, estimatedHours: projects.estimatedHours, remainingHours: projects.remainingHours, feeType: projects.feeType, feeAmount: projects.feeAmount, scope: projects.scope, notes: projects.notes })
      .from(projects)
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .orderBy(asc(projects.id));
  } else if (what === "time") {
    rows = await db
      .select({ id: timeEntries.id, user: users.name, project: projects.name, date: timeEntries.entryDate, minutes: timeEntries.durationMinutes, billable: timeEntries.billable, notes: timeEntries.notes, source: timeEntries.source, startedAt: timeEntries.startedAt, endedAt: timeEntries.endedAt })
      .from(timeEntries)
      .innerJoin(users, eq(users.id, timeEntries.userId))
      .innerJoin(projects, eq(projects.id, timeEntries.projectId))
      .orderBy(asc(timeEntries.entryDate), asc(timeEntries.id));
  } else if (what === "estimates") {
    rows = await db
      .select({ id: estimates.id, project: projects.name, revision: estimates.revision, scopeKind: estimates.scopeKind, status: estimates.status, feeType: estimates.feeType, hourlyRate: estimates.hourlyRate, totalHours: estimates.totalHours, totalFee: estimates.totalFee, approvedAt: estimates.approvedAt, createdAt: estimates.createdAt })
      .from(estimates)
      .innerJoin(projects, eq(projects.id, estimates.projectId))
      .orderBy(asc(estimates.id));
  } else if (what === "all") {
    const [c, ct, co, p, t, pi, e, el, te, wb, al] = await Promise.all([
      db.select().from(clients),
      db.select().from(contacts),
      db.select().from(correspondence),
      db.select().from(projects),
      db.select().from(tasks),
      db.select().from(projectItems),
      db.select().from(estimates),
      db.select().from(estimateLines),
      db.select().from(timeEntries),
      db.select().from(workBlocks),
      db.select().from(auditLog),
    ]);
    const payload = { exportedAt: new Date().toISOString(), clients: c, contacts: ct, correspondence: co, projects: p, tasks: t, projectItems: pi, estimates: e, estimateLines: el, timeEntries: te, workBlocks: wb, auditLog: al };
    await audit(user.id, "export.all", "system", null, "Exported all records (JSON)");
    return new Response(JSON.stringify(payload, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="workbench-export-${stamp}.json"` } });
  } else {
    throw new ApiError("Unknown export", 400);
  }
  await audit(user.id, "export." + what, "system", null, `Exported ${what} (${format})`);
  if (format === "json") return new Response(JSON.stringify(rows, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${name}-${stamp}.json"` } });
  return new Response(csv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-${stamp}.csv"` } });
});
