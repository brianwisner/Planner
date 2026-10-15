import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/lib/db";
import { estimates, projectItems, projectTypes, projects, timeEntries } from "@/lib/db/schema";
import { getBlocks, getCapacity, summarizeRange } from "@/lib/services/schedule";
import { listProjects } from "@/lib/services/projects";
import { num } from "@/lib/format";

export async function workloadReport(userId: number, tz: string, weeks = 8) {
  const start = DateTime.now().setZone(tz).startOf("week");
  const from = start.toISODate()!;
  const to = start.plus({ weeks }).minus({ days: 1 }).toISODate()!;
  const [{ days }, blocks] = await Promise.all([getCapacity(userId, from, to), getBlocks(userId, from, to)]);
  const summarized = summarizeRange(days, blocks);
  const out: { label: string; available: number; planned: number; overbookedDays: number }[] = [];
  for (let i = 0; i < summarized.length; i += 7) {
    const chunk = summarized.slice(i, i + 7);
    out.push({
      label: DateTime.fromISO(chunk[0].date).toFormat("LLL d"),
      available: Math.round(chunk.reduce((s, d) => s + d.availableHours, 0) * 10) / 10,
      planned: Math.round(chunk.reduce((s, d) => s + d.plannedHours, 0) * 10) / 10,
      overbookedDays: chunk.filter((d) => d.overbooked).length,
    });
  }
  return out;
}

export async function estimateVsActual() {
  const list = await listProjects({ status: ["accepted", "in_progress", "on_hold", "completed"] });
  return list
    .filter((p) => p.estimatedHours != null || p.actualHours > 0)
    .map((p) => ({ id: p.id, name: p.name, status: p.status, estimated: num(p.estimatedHours), actual: p.actualHours, remaining: p.status === "completed" ? 0 : p.remaining, clientDueDate: p.clientDueDate, projectTypeName: p.projectTypeName }))
    .sort((a, b) => (b.actual + b.remaining) - (a.actual + a.remaining));
}

export async function accuracyByType() {
  const rows = await db
    .select({
      typeId: projects.projectTypeId,
      typeName: projectTypes.name,
      projectId: projects.id,
      name: projects.name,
      actualMinutes: sql<number>`coalesce((select sum(t.duration_minutes)::int from ${timeEntries} t where t.project_id = ${projects}.id and (t.ended_at is not null or t.source = 'manual')), 0)`,
      scopeChangeHours: sql<number>`coalesce((select sum(i.hours_added)::float from ${projectItems} i where i.project_id = ${projects}.id and i.kind = 'scope_change'), 0)`,
      estimated: sql<number | null>`(select e.total_hours::float from ${estimates} e where e.project_id = ${projects}.id and e.scope_kind = 'original' and e.status = 'approved' order by e.approved_at desc limit 1)`,
      estimatedFallback: projects.estimatedHours,
    })
    .from(projects)
    .leftJoin(projectTypes, eq(projectTypes.id, projects.projectTypeId))
    .where(eq(projects.status, "completed"));
  const byType = new Map<string, { ratios: number[]; projects: { name: string; estimated: number; actual: number }[] }>();
  for (const r of rows) {
    const est = r.estimated ?? (r.estimatedFallback != null ? num(r.estimatedFallback) : null);
    const actual = Math.max(0, r.actualMinutes / 60 - r.scopeChangeHours);
    if (!est || est <= 0 || actual <= 0) continue;
    const key = r.typeName ?? "Untyped";
    const cur = byType.get(key) ?? { ratios: [], projects: [] };
    cur.ratios.push(actual / est);
    cur.projects.push({ name: r.name, estimated: est, actual: Math.round(actual * 10) / 10 });
    byType.set(key, cur);
  }
  return Array.from(byType.entries()).map(([type, v]) => ({ type, count: v.ratios.length, ratio: Math.round((v.ratios.reduce((s, x) => s + x, 0) / v.ratios.length) * 100) / 100, projects: v.projects }));
}

export async function deadlinesReport(tz: string) {
  const today = DateTime.now().setZone(tz).toISODate()!;
  const soon = DateTime.fromISO(today).plus({ days: 45 }).toISODate()!;
  const list = await listProjects({ status: ["accepted", "in_progress", "proposed", "inquiry"] });
  return list
    .filter((p) => (p.clientDueDate && p.clientDueDate <= soon) || (p.targetCompletion && p.targetCompletion <= soon))
    .map((p) => ({ ...p, due: p.clientDueDate ?? p.targetCompletion!, kind: p.clientDueDate ? "client" : "target", forecast: p.lastScheduledDate, daysLeft: Math.round(DateTime.fromISO(p.clientDueDate ?? p.targetCompletion!).diff(DateTime.fromISO(today), "days").days) }))
    .sort((a, b) => a.due.localeCompare(b.due));
}

export async function timeByProject(from: string, to: string) {
  const rows = await db
    .select({ projectId: timeEntries.projectId, name: projects.name, minutes: sql<number>`sum(${timeEntries.durationMinutes})::int`, billable: sql<number>`sum(case when ${timeEntries.billable} then ${timeEntries.durationMinutes} else 0 end)::int` })
    .from(timeEntries)
    .innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .where(and(gte(timeEntries.entryDate, from), lte(timeEntries.entryDate, to), inArray(timeEntries.source, ["manual", "timer"]), sql`(${timeEntries.endedAt} is not null or ${timeEntries.source} = 'manual')`))
    .groupBy(timeEntries.projectId, projects.name)
    .orderBy(sql`sum(${timeEntries.durationMinutes}) desc`);
  return rows;
}
