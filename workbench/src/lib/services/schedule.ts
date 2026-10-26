import { and, asc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/lib/db";
import {
  availabilityExceptions,
  availabilityRules,
  calendarEvents,
  calendars,
  googleAccounts,
  projectDependencies,
  projects,
  scheduleProposals,
  schedulingPrefs,
  workBlocks,
  COMMITTED_STATUSES,
  type ProposalBlock,
  type ProposalSummary,
  type ScenarioOverrides,
} from "@/lib/db/schema";
import { computeDayCapacity, dateRange, resolveDayWindow, type DayCapacity } from "@/lib/engine/capacity";
import { recommendSchedule, type ExistingBlock, type SchedProject } from "@/lib/engine/scheduler";
import { listProjects } from "@/lib/services/projects";
import { num } from "@/lib/format";
import { audit } from "@/lib/audit";

export async function getPrefs(userId: number) {
  const [p] = await db.select().from(schedulingPrefs).where(eq(schedulingPrefs.userId, userId));
  if (p) return p;
  const [created] = await db.insert(schedulingPrefs).values({ userId }).onConflictDoNothing().returning();
  return created ?? { userId, bufferPercent: 10, maxConcurrentProjects: 2, minBlockHours: "1", horizonDays: 42, timezone: "America/Los_Angeles" };
}

export async function getAvailability(userId: number) {
  const [rules, exceptions, prefs] = await Promise.all([
    db.select().from(availabilityRules).where(eq(availabilityRules.userId, userId)).orderBy(asc(availabilityRules.weekday)),
    db.select().from(availabilityExceptions).where(eq(availabilityExceptions.userId, userId)).orderBy(asc(availabilityExceptions.date)),
    getPrefs(userId),
  ]);
  return { rules, exceptions, prefs };
}

/** Busy calendar events for the user's selected calendars in a date range (app-published blocks excluded). */
export async function getBusyEvents(userId: number, from: string, to: string, tz: string) {
  const start = DateTime.fromISO(from, { zone: tz }).startOf("day").toJSDate();
  const end = DateTime.fromISO(to, { zone: tz }).endOf("day").toJSDate();
  const rows = await db
    .select({
      id: calendarEvents.id,
      summary: calendarEvents.summary,
      startAt: calendarEvents.startAt,
      endAt: calendarEvents.endAt,
      allDay: calendarEvents.allDay,
      busy: calendarEvents.busy,
      status: calendarEvents.status,
      calendarName: calendars.summary,
    })
    .from(calendarEvents)
    .innerJoin(calendars, eq(calendars.id, calendarEvents.calendarId))
    .innerJoin(googleAccounts, eq(googleAccounts.id, calendars.googleAccountId))
    .where(
      and(
        eq(googleAccounts.userId, userId),
        eq(calendars.affectsAvailability, true),
        eq(calendarEvents.isAppBlock, false),
        ne(calendarEvents.status, "cancelled"),
        lte(calendarEvents.startAt, end),
        gte(calendarEvents.endAt, start),
      ),
    )
    .orderBy(asc(calendarEvents.startAt));
  return rows;
}

export async function getCapacity(userId: number, from: string, to: string, overrides?: ScenarioOverrides["capacity"]) {
  const { rules, exceptions, prefs } = await getAvailability(userId);
  const tz = prefs.timezone;
  const events = await getBusyEvents(userId, from, to, tz);
  const busy = events.map((e) => ({ start: e.startAt, end: e.endAt, allDay: e.allDay, busy: e.busy, summary: e.summary, status: e.status }));
  const buffer = overrides?.bufferPercent ?? prefs.bufferPercent;
  const days: DayCapacity[] = dateRange(from, to).map((date) => {
    const c = computeDayCapacity(resolveDayWindow(date, rules, exceptions, tz), busy, tz, buffer);
    if (overrides?.extraHoursPerDay && !c.off) c.availableHours = Math.max(0, Math.round((c.availableHours + overrides.extraHoursPerDay) * 100) / 100);
    return c;
  });
  return { days, prefs, tz };
}

export async function getBlocks(userId: number, from: string, to: string) {
  return db
    .select({
      id: workBlocks.id,
      userId: workBlocks.userId,
      projectId: workBlocks.projectId,
      projectName: projects.name,
      projectStatus: projects.status,
      clientDueDate: projects.clientDueDate,
      taskId: workBlocks.taskId,
      date: workBlocks.date,
      hours: workBlocks.hours,
      startMinute: workBlocks.startMinute,
      kind: workBlocks.kind,
      title: workBlocks.title,
      locked: workBlocks.locked,
      source: workBlocks.source,
      sortOrder: workBlocks.sortOrder,
      note: workBlocks.note,
      googleEventId: workBlocks.googleEventId,
      version: workBlocks.version,
    })
    .from(workBlocks)
    .leftJoin(projects, eq(projects.id, workBlocks.projectId))
    .where(and(eq(workBlocks.userId, userId), gte(workBlocks.date, from), lte(workBlocks.date, to)))
    .orderBy(asc(workBlocks.date), asc(workBlocks.sortOrder), asc(workBlocks.id));
}

export async function buildSchedProjects(overrides?: ScenarioOverrides["projects"]): Promise<SchedProject[]> {
  const list = await listProjects({ status: ["inquiry", "proposed", "accepted", "in_progress", "on_hold"] });
  const deps = await db.select().from(projectDependencies);
  return list
    .map((p) => {
      const o = overrides?.[String(p.id)];
      const status = o?.status ?? p.status;
      const sp: SchedProject = {
        id: p.id,
        name: p.name,
        remainingHours: o?.remainingHours ?? p.remaining,
        priority: o?.priority ?? p.priority,
        status,
        committed: COMMITTED_STATUSES.includes(status as (typeof COMMITTED_STATUSES)[number]),
        tentativeReserve: o?.include ?? p.tentativeReserve,
        blocked: p.blocksScheduling,
        blockedReason: p.blocksScheduling ? `Open blocker${p.openBlockers > 1 ? "s" : ""} on project` : undefined,
        dependsOn: deps.filter((d) => d.projectId === p.id).map((d) => d.dependsOnId),
        clientDueDate: o?.clientDueDate !== undefined ? o.clientDueDate : p.clientDueDate,
        targetCompletion: p.targetCompletion,
        plannedStart: p.plannedStart,
        acceptanceDate: p.acceptanceDate,
      };
      if (o?.include === false) sp.status = "declined";
      return sp;
    });
}

export async function runRecommendation(userId: number, opts: { horizonDays?: number; includeTentative?: boolean; overrides?: ScenarioOverrides; today?: string }) {
  const prefs = await getPrefs(userId);
  const tz = prefs.timezone;
  const today = opts.today ?? DateTime.now().setZone(tz).toISODate()!;
  const horizonDays = opts.overrides?.horizonDays ?? opts.horizonDays ?? prefs.horizonDays;
  const to = DateTime.fromISO(today).plus({ days: horizonDays - 1 }).toISODate()!;
  const { days } = await getCapacity(userId, today, to, opts.overrides?.capacity);
  const projectsIn = await buildSchedProjects(opts.overrides?.projects);
  const existingRows = await getBlocks(userId, today, to);
  const existing: ExistingBlock[] = existingRows.map((b) => ({ id: b.id, projectId: b.projectId, date: b.date, hours: num(b.hours), locked: b.locked, kind: b.kind, title: b.title }));
  const result = recommendSchedule(
    days.map((d) => ({ date: d.date, availableHours: d.availableHours, off: d.off })),
    projectsIn,
    existing,
    {
      today,
      maxConcurrentProjects: opts.overrides?.capacity?.maxConcurrentProjects ?? prefs.maxConcurrentProjects,
      minBlockHours: num(prefs.minBlockHours, 1),
      includeTentative: opts.includeTentative ?? false,
    },
  );
  const summary: ProposalSummary = {
    horizonStart: today,
    horizonEnd: to,
    moves: result.moves,
    forecasts: result.forecasts,
    warnings: result.warnings,
    unscheduled: result.unscheduled,
  };
  return { today, to, days, result, summary, blocks: result.blocks as ProposalBlock[], projects: projectsIn, existing: existingRows };
}

export async function createProposal(userId: number, createdBy: number, title: string, run: Awaited<ReturnType<typeof runRecommendation>>, params: unknown) {
  const [row] = await db
    .insert(scheduleProposals)
    .values({ userId, createdBy, title, params, blocks: run.blocks, summary: run.summary, status: "proposed" })
    .returning();
  await audit(createdBy, "proposal.create", "proposal", row.id, `Proposed schedule: ${title} (${run.summary.moves.length} changes)`);
  return row;
}

/** Applies a proposal: replaces unlocked future work blocks in the horizon with the proposal's blocks. Owner only (checked by caller). */
export async function applyProposal(proposalId: number, ownerId: number) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(scheduleProposals).where(eq(scheduleProposals.id, proposalId)).for("update");
    if (!p) throw new Error("Proposal not found");
    if (p.status !== "proposed") throw new Error(`Proposal is already ${p.status}`);
    const { horizonStart, horizonEnd } = p.summary;
    const replaceable = await tx
      .select()
      .from(workBlocks)
      .where(and(eq(workBlocks.userId, p.userId), gte(workBlocks.date, horizonStart), lte(workBlocks.date, horizonEnd), eq(workBlocks.kind, "work"), eq(workBlocks.locked, false)));
    const snapshot = replaceable.map((b) => ({ ...b, createdAt: b.createdAt.toISOString(), updatedAt: b.updatedAt.toISOString() }));
    if (replaceable.length) await tx.delete(workBlocks).where(inArray(workBlocks.id, replaceable.map((b) => b.id)));
    const toInsert = p.blocks.filter((b) => !b.existingId || !b.locked);
    const inserted = toInsert.length
      ? await tx
          .insert(workBlocks)
          .values(toInsert.map((b, i) => ({ userId: p.userId, projectId: b.projectId, date: b.date, hours: String(b.hours), kind: "work" as const, locked: false, source: "recommendation" as const, sortOrder: 100 + i })))
          .returning({ id: workBlocks.id })
      : [];
    await tx
      .update(scheduleProposals)
      .set({ status: "accepted", decidedBy: ownerId, decidedAt: new Date(), undoSnapshot: { removed: snapshot, insertedIds: inserted.map((r) => r.id) } })
      .where(eq(scheduleProposals.id, proposalId));
    // Other open proposals for this schedule are now stale.
    await tx
      .update(scheduleProposals)
      .set({ status: "superseded" })
      .where(and(eq(scheduleProposals.userId, p.userId), eq(scheduleProposals.status, "proposed"), ne(scheduleProposals.id, proposalId)));
    await tx.insert((await import("@/lib/db/schema")).auditLog).values({
      userId: ownerId,
      action: "proposal.accept",
      entityType: "proposal",
      entityId: String(proposalId),
      summary: `Accepted schedule proposal "${p.title}": ${inserted.length} blocks applied, ${replaceable.length} replaced`,
    });
    return { inserted: inserted.length, replaced: replaceable.length };
  });
}

export async function undoProposal(proposalId: number, ownerId: number) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(scheduleProposals).where(eq(scheduleProposals.id, proposalId)).for("update");
    if (!p) throw new Error("Proposal not found");
    if (p.status !== "accepted") throw new Error("Only an accepted proposal can be undone");
    const snap = (p.undoSnapshot ?? {}) as { removed?: Record<string, unknown>[]; insertedIds?: number[] };
    if (snap.insertedIds?.length) await tx.delete(workBlocks).where(inArray(workBlocks.id, snap.insertedIds));
    if (snap.removed?.length) {
      await tx.insert(workBlocks).values(
        snap.removed.map((b) => ({
          id: b.id as number, // restore with the original id so Google write-back mappings stay valid
          userId: b.userId as number,
          projectId: (b.projectId as number | null) ?? null,
          taskId: (b.taskId as number | null) ?? null,
          date: b.date as string,
          hours: String(b.hours),
          startMinute: (b.startMinute as number | null) ?? null,
          kind: b.kind as "work" | "commitment",
          title: (b.title as string | null) ?? null,
          locked: !!b.locked,
          source: b.source as "manual" | "recommendation",
          sortOrder: (b.sortOrder as number) ?? 0,
          note: (b.note as string | null) ?? null,
          googleEventId: (b.googleEventId as string | null) ?? null,
          googleCalendarId: (b.googleCalendarId as string | null) ?? null,
        })),
      );
    }
    await tx.update(scheduleProposals).set({ status: "undone" }).where(eq(scheduleProposals.id, proposalId));
    await tx.insert((await import("@/lib/db/schema")).auditLog).values({
      userId: ownerId,
      action: "proposal.undo",
      entityType: "proposal",
      entityId: String(proposalId),
      summary: `Undid schedule proposal "${p.title}": restored ${snap.removed?.length ?? 0} blocks, removed ${snap.insertedIds?.length ?? 0}`,
    });
    return { restored: snap.removed?.length ?? 0, removed: snap.insertedIds?.length ?? 0 };
  });
}

/** Day totals vs capacity for conflict warnings on manual edits. */
export async function dayConflict(userId: number, date: string, extraHours: number, excludeBlockId?: number) {
  const { days } = await getCapacity(userId, date, date);
  const cap = days[0];
  const rows = await db
    .select({ id: workBlocks.id, hours: workBlocks.hours })
    .from(workBlocks)
    .where(and(eq(workBlocks.userId, userId), eq(workBlocks.date, date)));
  const existingHours = rows.filter((r) => r.id !== excludeBlockId).reduce((s, r) => s + num(r.hours), 0);
  const total = Math.round((existingHours + extraHours) * 100) / 100;
  return {
    date,
    availableHours: cap.availableHours,
    off: cap.off,
    totalAfter: total,
    overbookedBy: Math.round(Math.max(0, total - cap.availableHours) * 100) / 100,
    overbooked: total > cap.availableHours + 0.001,
    appointments: cap.events.length,
  };
}

/** Recomputes derived "forecast" and flags for the schedule view. */
export function summarizeRange(days: DayCapacity[], blocks: Awaited<ReturnType<typeof getBlocks>>) {
  return days.map((d) => {
    const dayBlocks = blocks.filter((b) => b.date === d.date);
    const planned = Math.round(dayBlocks.reduce((s, b) => s + num(b.hours), 0) * 100) / 100;
    return { ...d, blocks: dayBlocks, plannedHours: planned, overbooked: planned > d.availableHours + 0.001, overbookedBy: Math.round(Math.max(0, planned - d.availableHours) * 100) / 100 };
  });
}

export const sqlNow = sql`now()`;
