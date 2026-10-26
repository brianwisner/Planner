import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/lib/db";
import { estimates, projectItems, projects, scheduleProposals, users } from "@/lib/db/schema";
import { getBlocks, getCapacity, summarizeRange } from "@/lib/services/schedule";
import { listProjects } from "@/lib/services/projects";
import { listTimeEntries } from "@/lib/services/time";

export async function getTodayData(userId: number, tz: string, scheduleUserId: number) {
  const today = DateTime.now().setZone(tz).toISODate()!;
  const weekEnd = DateTime.fromISO(today).plus({ days: 6 }).toISODate()!;
  const soon = DateTime.fromISO(today).plus({ days: 14 }).toISODate()!;
  const [{ days }, blocks, projs, timeToday, pendingEstimates, proposals, openItems] = await Promise.all([
    getCapacity(scheduleUserId, today, weekEnd),
    getBlocks(scheduleUserId, today, weekEnd),
    listProjects({ status: ["accepted", "in_progress", "proposed", "inquiry", "on_hold"] }),
    listTimeEntries({ userId, from: today, to: today }),
    db
      .select({ id: estimates.id, projectId: estimates.projectId, projectName: projects.name, revision: estimates.revision, totalHours: estimates.totalHours, totalFee: estimates.totalFee, preparedByName: users.name, submittedAt: estimates.submittedAt })
      .from(estimates)
      .innerJoin(projects, eq(projects.id, estimates.projectId))
      .leftJoin(users, eq(users.id, estimates.preparedBy))
      .where(eq(estimates.status, "submitted"))
      .orderBy(asc(estimates.submittedAt)),
    db
      .select({ id: scheduleProposals.id, title: scheduleProposals.title, createdAt: scheduleProposals.createdAt, createdByName: users.name, summary: scheduleProposals.summary })
      .from(scheduleProposals)
      .leftJoin(users, eq(users.id, scheduleProposals.createdBy))
      .where(and(eq(scheduleProposals.status, "proposed"), eq(scheduleProposals.userId, scheduleUserId)))
      .orderBy(desc(scheduleProposals.createdAt)),
    db
      .select({ id: projectItems.id, projectId: projectItems.projectId, projectName: projects.name, kind: projectItems.kind, description: projectItems.description, createdAt: projectItems.createdAt })
      .from(projectItems)
      .innerJoin(projects, eq(projects.id, projectItems.projectId))
      .where(and(eq(projectItems.status, "open"), inArray(projectItems.kind, ["waiting", "blocker"]), inArray(projects.status, ["accepted", "in_progress", "proposed"])))
      .orderBy(asc(projectItems.createdAt)),
  ]);
  const week = summarizeRange(days, blocks);
  const todayCap = week[0];
  const committed = projs.filter((p) => p.committed);
  const deadlines = committed
    .map((p) => {
      const due = p.clientDueDate ?? p.targetCompletion;
      const forecast = p.lastScheduledDate;
      const unscheduled = p.remaining > 0 && (!forecast || forecast < today);
      const atRisk = (!!due && !!forecast && forecast > due) || (!!due && due <= soon && unscheduled) || (!!due && due < today && p.remaining > 0);
      return { ...p, due, forecast, atRisk, unscheduled, overdue: !!due && due < today && p.status !== "completed" };
    })
    .filter((p) => (p.due && p.due <= soon) || p.atRisk)
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  const loggedMinutes = timeToday.filter((t) => t.endedAt || t.source === "manual").reduce((s, t) => s + t.durationMinutes, 0);
  const pipeline = projs.filter((p) => !p.committed && p.status !== "on_hold");
  return { today, todayCap, week, projects: committed, pipeline, deadlines, loggedMinutes, timeToday, pendingEstimates, proposals, openItems };
}
