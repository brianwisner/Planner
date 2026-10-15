import { describe, it, expect } from "vitest";
import { recommendSchedule, type SchedDay, type SchedProject, type ExistingBlock } from "@/lib/engine/scheduler";

const days: SchedDay[] = [];
for (let i = 0; i < 14; i++) {
  const d = new Date(Date.UTC(2026, 9, 12 + i)); // Mon 2026-10-12 ..
  const iso = d.toISOString().slice(0, 10);
  const dow = d.getUTCDay();
  days.push({ date: iso, availableHours: dow === 0 || dow === 6 ? 0 : 6, off: dow === 0 || dow === 6 });
}
const base = (o: Partial<SchedProject>): SchedProject => ({
  id: 1,
  name: "P",
  remainingHours: 10,
  priority: 3,
  status: "accepted",
  committed: true,
  tentativeReserve: false,
  blocked: false,
  dependsOn: [],
  clientDueDate: null,
  targetCompletion: null,
  plannedStart: null,
  acceptanceDate: "2026-10-01",
  ...o,
});
const params = { today: "2026-10-12", maxConcurrentProjects: 2, minBlockHours: 1, includeTentative: false };

describe("scheduler", () => {
  it("fills capacity and forecasts completion", () => {
    const r = recommendSchedule(days, [base({ id: 1, remainingHours: 10 })], [], params);
    const total = r.blocks.reduce((s, b) => s + b.hours, 0);
    expect(total).toBe(10);
    expect(r.forecasts[0].forecastCompletion).toBe("2026-10-13");
    expect(r.dayLoad.every((d) => d.plannedHours <= d.availableHours)).toBe(true);
  });
  it("keeps locked blocks exactly and reduces that project's remaining work", () => {
    const existing: ExistingBlock[] = [{ id: 9, projectId: 1, date: "2026-10-20", hours: 4, locked: true, kind: "work" }];
    const r = recommendSchedule(days, [base({ id: 1, remainingHours: 10 })], existing, params);
    const locked = r.blocks.find((b) => b.existingId === 9);
    expect(locked).toMatchObject({ date: "2026-10-20", hours: 4, locked: true });
    expect(r.blocks.reduce((s, b) => s + b.hours, 0)).toBe(10);
    // Day with locked block only has 2h left for others.
    expect(r.dayLoad.find((d) => d.date === "2026-10-20")!.plannedHours).toBeLessThanOrEqual(6);
  });
  it("excludes unaccepted opportunities unless tentatively reserved", () => {
    const projs = [base({ id: 1, status: "inquiry", committed: false }), base({ id: 2, status: "inquiry", committed: false, tentativeReserve: true })];
    const r1 = recommendSchedule(days, projs, [], params);
    expect(r1.blocks.length).toBe(0);
    const r2 = recommendSchedule(days, projs, [], { ...params, includeTentative: true });
    expect(r2.blocks.every((b) => b.projectId === 2)).toBe(true);
    expect(r2.blocks.length).toBeGreaterThan(0);
  });
  it("urgent deadline goes first regardless of priority", () => {
    const projs = [base({ id: 1, priority: 1, remainingHours: 20 }), base({ id: 2, priority: 4, remainingHours: 6, clientDueDate: "2026-10-13" })];
    const r = recommendSchedule(days, projs, [], params);
    expect(r.blocks[0].projectId).toBe(2);
    expect(r.forecasts.find((f) => f.projectId === 2)!.atRisk).toBe(false);
  });
  it("flags at-risk work when a deadline cannot be met", () => {
    const projs = [base({ id: 1, remainingHours: 40, clientDueDate: "2026-10-14" })];
    const r = recommendSchedule(days, projs, [], params);
    const f = r.forecasts[0];
    expect(f.atRisk).toBe(true);
    expect(f.forecastCompletion! > "2026-10-14").toBe(true);
  });
  it("respects dependencies and blockers", () => {
    const projs = [base({ id: 1, remainingHours: 6 }), base({ id: 2, remainingHours: 6, dependsOn: [1] }), base({ id: 3, blocked: true, blockedReason: "Waiting on survey" })];
    const r = recommendSchedule(days, projs, [], params);
    const firstOf2 = r.blocks.filter((b) => b.projectId === 2).map((b) => b.date).sort()[0];
    const lastOf1 = r.blocks.filter((b) => b.projectId === 1).map((b) => b.date).sort().pop()!;
    expect(firstOf2 > lastOf1).toBe(true);
    expect(r.unscheduled.find((u) => u.projectId === 3)?.reason).toBe("Waiting on survey");
  });
  it("limits concurrent projects", () => {
    const projs = [1, 2, 3, 4].map((id) => base({ id, name: `P${id}`, remainingHours: 12 }));
    const r = recommendSchedule(days, projs, [], { ...params, maxConcurrentProjects: 2 });
    const firstDay = r.blocks.filter((b) => b.date === "2026-10-12").map((b) => b.projectId);
    expect(new Set(firstDay).size).toBeLessThanOrEqual(2);
  });
  it("warns when fixed work overbooks a day", () => {
    const existing: ExistingBlock[] = [{ id: 1, projectId: null, date: "2026-10-12", hours: 8, locked: true, kind: "commitment", title: "Site visit" }];
    const r = recommendSchedule(days, [base({})], existing, params);
    expect(r.warnings.some((w) => w.includes("2026-10-12"))).toBe(true);
    expect(r.dayLoad[0].overbooked).toBe(true);
  });
  it("does not schedule before planned start", () => {
    const r = recommendSchedule(days, [base({ plannedStart: "2026-10-19" })], [], params);
    expect(r.blocks.every((b) => b.date >= "2026-10-19")).toBe(true);
  });
});
