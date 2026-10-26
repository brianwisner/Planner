import { DateTime } from "luxon";

export type SchedProject = {
  id: number;
  name: string;
  remainingHours: number;
  priority: number; // 1 urgent .. 4 low
  status: string;
  committed: boolean; // accepted / in progress
  tentativeReserve: boolean;
  blocked: boolean;
  blockedReason?: string;
  dependsOn: number[];
  clientDueDate: string | null;
  targetCompletion: string | null;
  plannedStart: string | null;
  acceptanceDate: string | null;
};

export type SchedDay = { date: string; availableHours: number; off: boolean };

export type ExistingBlock = {
  id: number;
  projectId: number | null;
  date: string;
  hours: number;
  locked: boolean;
  kind: "work" | "commitment";
  title?: string | null;
};

export type SchedParams = {
  today: string;
  maxConcurrentProjects: number;
  minBlockHours: number;
  includeTentative: boolean;
  /** Projects to pin (keep their existing unlocked blocks too). */
  respectManual?: boolean;
};

export type PlanBlock = { projectId: number; date: string; hours: number; locked?: boolean; existingId?: number };
export type Forecast = {
  projectId: number;
  projectName: string;
  forecastCompletion: string | null;
  previousForecast: string | null;
  clientDueDate: string | null;
  targetCompletion: string | null;
  atRisk: boolean;
  reason?: string;
};
export type Move = { projectId: number; projectName: string; change: string; reason: string };
export type PlanResult = {
  blocks: PlanBlock[];
  forecasts: Forecast[];
  moves: Move[];
  warnings: string[];
  unscheduled: { projectId: number; projectName: string; reason: string }[];
  dayLoad: { date: string; availableHours: number; plannedHours: number; fixedHours: number; overbooked: boolean }[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function deadlineOf(p: SchedProject) {
  return p.clientDueDate ?? p.targetCompletion ?? null;
}

/** Last date on which a project has any block. */
export function forecastFromBlocks(blocks: { projectId: number | null; date: string }[], projectId: number) {
  const dates = blocks.filter((b) => b.projectId === projectId).map((b) => b.date);
  return dates.length ? dates.sort()[dates.length - 1] : null;
}

/**
 * Greedy, explainable scheduler:
 * - keeps locked blocks and fixed commitments exactly where they are;
 * - fills each day's remaining capacity in order of urgency (deadline slack), then priority, then age;
 * - prefers to continue projects already in progress up to the concurrent-project limit;
 * - respects dependencies, blockers, planned start dates and committed-vs-tentative status.
 */
export function recommendSchedule(days: SchedDay[], projects: SchedProject[], existing: ExistingBlock[], params: SchedParams): PlanResult {
  const warnings: string[] = [];
  const unscheduled: PlanResult["unscheduled"] = [];
  const horizon = days.filter((d) => d.date >= params.today);
  const horizonDates = new Set(horizon.map((d) => d.date));

  // Fixed hours per day: locked blocks and commitments inside the horizon.
  const fixedByDay = new Map<string, number>();
  const keptBlocks: PlanBlock[] = [];
  const lockedHoursByProject = new Map<number, number>();
  for (const b of existing) {
    if (!horizonDates.has(b.date)) continue;
    if (b.locked || b.kind === "commitment") {
      fixedByDay.set(b.date, (fixedByDay.get(b.date) ?? 0) + b.hours);
      if (b.projectId != null) {
        keptBlocks.push({ projectId: b.projectId, date: b.date, hours: b.hours, locked: true, existingId: b.id });
        lockedHoursByProject.set(b.projectId, (lockedHoursByProject.get(b.projectId) ?? 0) + b.hours);
      }
    }
  }

  const avgCap = horizon.length ? Math.max(0.5, horizon.reduce((s, d) => s + d.availableHours, 0) / Math.max(1, horizon.filter((d) => !d.off).length)) : 1;
  const byId = new Map(projects.map((p) => [p.id, p]));

  // Candidates and their remaining work after locked blocks.
  const remaining = new Map<number, number>();
  const candidates: SchedProject[] = [];
  for (const p of projects) {
    if (["completed", "declined", "on_hold"].includes(p.status)) continue;
    if (p.remainingHours <= 0) continue;
    if (!p.committed && !(p.tentativeReserve && params.includeTentative)) {
      if (p.tentativeReserve === false && p.status !== "inquiry" && p.status !== "proposed") continue;
      continue; // opportunities stay visible elsewhere but out of committed workload
    }
    if (p.blocked) {
      unscheduled.push({ projectId: p.id, projectName: p.name, reason: p.blockedReason ?? "Blocked" });
      continue;
    }
    const rem = r2(Math.max(0, p.remainingHours - (lockedHoursByProject.get(p.id) ?? 0)));
    remaining.set(p.id, rem);
    if (rem > 0) candidates.push(p);
  }

  // Dependency completion tracking within the simulation.
  const doneDate = new Map<number, string>();
  for (const p of projects) if (p.status === "completed") doneDate.set(p.id, "0000-00-00");
  for (const p of candidates) if ((remaining.get(p.id) ?? 0) === 0) doneDate.set(p.id, params.today);
  const depsSatisfied = (p: SchedProject, date: string) =>
    p.dependsOn.every((d) => {
      if (!byId.has(d)) return true;
      const dd = doneDate.get(d);
      return dd != null && dd < date;
    });

  const urgency = (p: SchedProject, date: string) => {
    const dl = deadlineOf(p);
    if (!dl) return 999;
    const daysLeft = DateTime.fromISO(dl).diff(DateTime.fromISO(date), "days").days;
    const needDays = (remaining.get(p.id) ?? 0) / avgCap;
    return daysLeft - needDays; // slack in days; negative = cannot make it
  };

  const sortKey = (a: SchedProject, b: SchedProject, date: string) => {
    const ua = urgency(a, date);
    const ub = urgency(b, date);
    const ca = ua < 2 ? 0 : 1;
    const cb = ub < 2 ? 0 : 1;
    if (ca !== cb) return ca - cb;
    if (ca === 0 && ua !== ub) return ua - ub;
    if (a.priority !== b.priority) return a.priority - b.priority;
    const da = deadlineOf(a) ?? "9999";
    const dbb = deadlineOf(b) ?? "9999";
    if (da !== dbb) return da < dbb ? -1 : 1;
    const aa = a.acceptanceDate ?? "9999";
    const ab = b.acceptanceDate ?? "9999";
    return aa < ab ? -1 : aa > ab ? 1 : a.id - b.id;
  };

  const newBlocks: PlanBlock[] = [];
  const dayLoad: PlanResult["dayLoad"] = [];
  const lastWorked = new Map<number, string>(); // projectId -> last date with a block (for continuity)
  const inProgressIds = new Set(projects.filter((p) => p.status === "in_progress").map((p) => p.id));
  const wipWarned = new Set<number>();

  for (const day of horizon) {
    const fixed = fixedByDay.get(day.date) ?? 0;
    let capLeft = r2(day.availableHours - fixed);
    const overbooked = fixed > day.availableHours + 0.001;
    if (overbooked) warnings.push(`${day.date}: locked and fixed work (${r2(fixed)} h) exceeds available time (${day.availableHours} h).`);
    let planned = 0;
    if (!day.off && capLeft > 0) {
      const eligible = candidates
        .filter((p) => (remaining.get(p.id) ?? 0) > 0)
        .filter((p) => !p.plannedStart || p.plannedStart <= day.date)
        .filter((p) => depsSatisfied(p, day.date))
        .sort((a, b) => sortKey(a, b, day.date));

      // Active set: projects touched in the last 7 days or already in progress.
      const recent = (p: SchedProject) => {
        const lw = lastWorked.get(p.id);
        if (lw && DateTime.fromISO(day.date).diff(DateTime.fromISO(lw), "days").days <= 7) return true;
        return inProgressIds.has(p.id) && !lastWorked.has(p.id) && day.date === params.today;
      };
      const active = eligible.filter(recent);
      const others = eligible.filter((p) => !recent(p));
      const ordered = [...active, ...others];
      let activeCount = active.length;

      for (const p of ordered) {
        if (capLeft < 0.25) break;
        const rem = remaining.get(p.id) ?? 0;
        if (rem <= 0) continue;
        const isActive = active.includes(p);
        if (!isActive && activeCount >= params.maxConcurrentProjects) {
          // Only preempt the limit for a project that will otherwise miss its deadline.
          if (urgency(p, day.date) >= 0) continue;
          if (!wipWarned.has(p.id)) {
            warnings.push(`${p.name} starts while ${activeCount} projects are already active (limit ${params.maxConcurrentProjects}) because its deadline is at risk.`);
            wipWarned.add(p.id);
          }
        }
        let hours = Math.min(rem, capLeft);
        if (hours < params.minBlockHours && hours < rem) continue; // avoid fragments
        hours = r2(hours);
        newBlocks.push({ projectId: p.id, date: day.date, hours });
        remaining.set(p.id, r2(rem - hours));
        capLeft = r2(capLeft - hours);
        planned += hours;
        if (!isActive) activeCount++;
        lastWorked.set(p.id, day.date);
        if ((remaining.get(p.id) ?? 0) <= 0.001) doneDate.set(p.id, day.date);
      }
    }
    dayLoad.push({ date: day.date, availableHours: day.availableHours, plannedHours: r2(planned + fixed), fixedHours: r2(fixed), overbooked });
  }

  const allBlocks = [...keptBlocks, ...newBlocks];

  // Forecasts and risk.
  const forecasts: Forecast[] = [];
  for (const p of candidates) {
    const rem = remaining.get(p.id) ?? 0;
    const fc = rem <= 0.001 ? forecastFromBlocks(allBlocks, p.id) : null;
    const prev = forecastFromBlocks(existing.filter((b) => b.date >= params.today), p.id);
    const dl = deadlineOf(p);
    let atRisk = false;
    let reason: string | undefined;
    if (!fc) {
      atRisk = !!dl && dl <= (horizon[horizon.length - 1]?.date ?? "");
      reason = `${r2(rem)} h would remain unscheduled at the end of the planning window`;
      if (p.dependsOn.some((d) => byId.has(d) && !doneDate.has(d))) reason = `Waiting on dependency: ${p.dependsOn.map((d) => byId.get(d)?.name).filter(Boolean).join(", ")}`;
      unscheduled.push({ projectId: p.id, projectName: p.name, reason });
    } else if (dl && fc > dl) {
      atRisk = true;
      reason = `Forecast ${fc} is after ${p.clientDueDate ? "client due date" : "target"} ${dl}`;
    }
    forecasts.push({
      projectId: p.id,
      projectName: p.name,
      forecastCompletion: fc,
      previousForecast: prev,
      clientDueDate: p.clientDueDate,
      targetCompletion: p.targetCompletion,
      atRisk,
      reason,
    });
  }

  // Moves: compare against existing unlocked future blocks per project.
  const moves: Move[] = [];
  const sumBy = (list: { projectId: number | null; date: string; hours: number }[]) => {
    const m = new Map<number, { hours: number; first: string; last: string }>();
    for (const b of list) {
      if (b.projectId == null) continue;
      const cur = m.get(b.projectId) ?? { hours: 0, first: b.date, last: b.date };
      cur.hours = r2(cur.hours + b.hours);
      if (b.date < cur.first) cur.first = b.date;
      if (b.date > cur.last) cur.last = b.date;
      m.set(b.projectId, cur);
    }
    return m;
  };
  const before = sumBy(existing.filter((b) => b.date >= params.today && b.kind === "work"));
  const after = sumBy(allBlocks);
  const ids = new Set([...before.keys(), ...after.keys()]);
  for (const id of ids) {
    const p = byId.get(id);
    if (!p) continue;
    const b = before.get(id);
    const a = after.get(id);
    const f = forecasts.find((f) => f.projectId === id);
    const why = f?.reason ?? (urgency(p, params.today) < 2 && deadlineOf(p) ? `Deadline ${deadlineOf(p)} leaves little slack` : `Priority ${p.priority}${p.acceptanceDate ? `, accepted ${p.acceptanceDate}` : ""}`);
    if (!b && a) moves.push({ projectId: id, projectName: p.name, change: `Scheduled ${a.hours} h from ${a.first} to ${a.last}`, reason: why });
    else if (b && !a) moves.push({ projectId: id, projectName: p.name, change: `Removed ${b.hours} h (was ${b.first} → ${b.last})`, reason: f?.reason ?? "No remaining work or no longer eligible" });
    else if (b && a && (b.hours !== a.hours || b.first !== a.first || b.last !== a.last))
      moves.push({ projectId: id, projectName: p.name, change: `${b.hours} h (${b.first} → ${b.last}) becomes ${a.hours} h (${a.first} → ${a.last})`, reason: why });
  }

  return { blocks: allBlocks, forecasts, moves, warnings, unscheduled, dayLoad };
}

/** Checks a manual block set for conflicts without changing anything. */
export function checkDayConflicts(date: string, availableHours: number, blocks: { hours: number }[]) {
  const total = r2(blocks.reduce((s, b) => s + b.hours, 0));
  return { total, availableHours, overbookedBy: r2(Math.max(0, total - availableHours)), overbooked: total > availableHours + 0.001 };
}
