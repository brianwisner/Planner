import { eq, like, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/lib/db";
import { clients, contacts, estimateLines, estimates, projectItems, projectTypes, projects, tasks, timeEntries } from "@/lib/db/schema";
import { assertSameOrigin, requireOwner } from "@/lib/auth/session";
import { ApiError, ok, route } from "@/lib/api";
import { audit } from "@/lib/audit";

const DEMO = "DEMO – ";

function guard() {
  if (process.env.APP_ENV !== "demo") throw new ApiError("Sample data is only available when APP_ENV=demo.", 403);
}

// Loads clearly-labeled sample data so the app can be explored. Never runs in production.
export const POST = route(async () => {
  const user = await requireOwner();
  await assertSameOrigin();
  guard();
  const types = await db.select().from(projectTypes);
  const t = (name: string) => types.find((x) => x.name.toLowerCase().startsWith(name.toLowerCase()))?.id ?? null;
  const today = DateTime.now().setZone("America/Los_Angeles");
  const d = (days: number) => today.plus({ days }).toISODate()!;

  const [c1] = await db.insert(clients).values({ name: `${DEMO}Dana Rivera`, company: "Rivera Builders", email: "dana@example.com", phone: "503-555-0101", kind: "contractor", address: "Astoria, OR", updatedBy: user.id }).returning();
  const [c2] = await db.insert(clients).values({ name: `${DEMO}Sam Okafor`, email: "sam@example.com", phone: "503-555-0102", kind: "homeowner", address: "Warrenton, OR", updatedBy: user.id }).returning();
  const [c3] = await db.insert(clients).values({ name: `${DEMO}Harbor Architects`, company: "Harbor Architects", email: "studio@example.com", kind: "architect", updatedBy: user.id }).returning();
  await db.insert(contacts).values([{ clientId: c1.id, name: "Dana Rivera", role: "Owner", email: "dana@example.com", isPrimary: true }, { clientId: c3.id, name: "Lee Park", role: "Project architect", email: "lee@example.com", isPrimary: true }]);

  const mk = async (v: Partial<typeof projects.$inferInsert> & { clientId: number; name: string }, taskList: { phase: string; name: string; hours: number; done?: boolean }[]) => {
    const [p] = await db.insert(projects).values({ complexity: "medium", priority: 3, status: "inquiry", updatedBy: user.id, ...v, name: DEMO + v.name }).returning();
    if (taskList.length) await db.insert(tasks).values(taskList.map((tk, i) => ({ projectId: p.id, name: tk.name, phase: tk.phase, estimatedHours: String(tk.hours), remainingHours: tk.done ? "0" : String(tk.hours), status: (tk.done ? "done" : "todo") as "done" | "todo", sortOrder: i })));
    return p;
  };
  // In progress with a near deadline
  const p1 = await mk({ clientId: c1.id, name: "Smith residence addition", address: "412 Alameda Ave, Astoria, OR", projectTypeId: t("Residential"), status: "in_progress", priority: 2, inquiryDate: d(-30), acceptanceDate: d(-20), actualStart: d(-10), clientDueDate: d(9), estimatedHours: "18", feeType: "fixed", feeAmount: "2700", scope: "Remove bearing wall between kitchen and living room; new flush beam and posts; footing check." }, [
    { phase: "Design", name: "Site visit and existing conditions", hours: 2, done: true }, { phase: "Design", name: "Gravity design", hours: 4, done: true }, { phase: "Design", name: "Lateral design", hours: 4 }, { phase: "Drawings", name: "Framing plans and details", hours: 6 }, { phase: "Submittal", name: "Calculation package", hours: 2 }]);
  // Accepted, not started
  const p2 = await mk({ clientId: c2.id, name: "Okafor deck", address: "88 Ridge Rd, Warrenton, OR", projectTypeId: t("Deck"), status: "accepted", priority: 3, inquiryDate: d(-12), acceptanceDate: d(-3), clientDueDate: d(21), estimatedHours: "7", feeType: "fixed", feeAmount: "1050", scope: "Elevated deck with hot tub; lateral bracing and ledger attachment." }, [
    { phase: "Design", name: "Design", hours: 3 }, { phase: "Drawings", name: "Plan and details", hours: 3 }, { phase: "Submittal", name: "Calculations", hours: 1 }]);
  // Accepted, bigger, later deadline, with a waiting item
  const p3 = await mk({ clientId: c3.id, name: "Bayview ADU", address: "1501 Bayview Dr, Astoria, OR", projectTypeId: t("Accessory"), status: "accepted", priority: 3, inquiryDate: d(-20), acceptanceDate: d(-5), plannedStart: d(3), clientDueDate: d(40), estimatedHours: "25", feeType: "fixed", feeAmount: "3750" }, [
    { phase: "Design", name: "Gravity and foundation design", hours: 6 }, { phase: "Design", name: "Lateral design", hours: 6 }, { phase: "Drawings", name: "Structural drawings", hours: 10 }, { phase: "Submittal", name: "Calculations and permit response", hours: 3 }]);
  await db.insert(projectItems).values({ projectId: p3.id, kind: "waiting", description: "Waiting on architect's updated floor plan", blocksScheduling: false, createdBy: user.id });
  // Blocked project
  const p4 = await mk({ clientId: c1.id, name: "Riverfront retaining wall", address: "Marine Dr, Astoria, OR", projectTypeId: t("Retaining"), status: "accepted", priority: 3, inquiryDate: d(-8), acceptanceDate: d(-2), estimatedHours: "7", feeType: "fixed", feeAmount: "1050" }, [{ phase: "Design", name: "Wall design and stability", hours: 4 }, { phase: "Drawings", name: "Details", hours: 2 }, { phase: "Submittal", name: "Calculations", hours: 1 }]);
  await db.insert(projectItems).values({ projectId: p4.id, kind: "blocker", description: "Need geotechnical report before design can start", blocksScheduling: true, createdBy: user.id });
  // Pipeline
  await mk({ clientId: c2.id, name: "Garage seismic retrofit", projectTypeId: t("Seismic"), status: "inquiry", priority: 4, inquiryDate: d(-1), estimatedHours: "15", feeType: "fixed", feeAmount: "2250" }, []);
  const p6 = await mk({ clientId: c3.id, name: "Cannery Row tenant improvement", projectTypeId: t("Commercial"), status: "proposed", priority: 3, tentativeReserve: true, inquiryDate: d(-6), clientDueDate: d(60), estimatedHours: "20", feeType: "hourly", hourlyRate: "150" }, []);
  // Completed history for estimate recommendations
  const hist = [
    { name: "Johnson kitchen remodel", est: 16, actual: 19, fee: 2400, done: -120, scope: 0 },
    { name: "Nguyen second-story addition", est: 20, actual: 26, fee: 3000, done: -75, scope: 4 },
    { name: "Alvarez bearing wall removal", est: 14, actual: 13, fee: 2100, done: -40, scope: 0 },
  ];
  for (const h of hist) {
    const p = await mk({ clientId: c1.id, name: h.name, projectTypeId: t("Residential"), status: "completed", inquiryDate: d(h.done - 60), acceptanceDate: d(h.done - 50), actualStart: d(h.done - 40), actualCompletion: d(h.done), estimatedHours: String(h.est), remainingHours: "0", feeType: "fixed", feeAmount: String(h.fee) }, []);
    const [e] = await db.insert(estimates).values({ projectId: p.id, revision: 1, scopeKind: "original", status: "approved", feeType: "fixed", hourlyRate: "150", totalHours: String(h.est), totalFee: String(h.fee), preparedBy: user.id, approvedBy: user.id, approvedAt: today.plus({ days: h.done - 55 }).toJSDate() }).returning();
    await db.insert(estimateLines).values([{ estimateId: e.id, phase: "Design", description: "Design", hours: String(h.est * 0.5), rate: "150", amount: String(h.fee * 0.5), sortOrder: 0 }, { estimateId: e.id, phase: "Drawings", description: "Drawings and calcs", hours: String(h.est * 0.5), rate: "150", amount: String(h.fee * 0.5), sortOrder: 1 }]);
    if (h.scope) await db.insert(projectItems).values({ projectId: p.id, kind: "scope_change", description: "Added garage header redesign", hoursAdded: String(h.scope), feeAdded: "600", createdBy: user.id, status: "resolved" });
    // Spread actual time over a few days
    const chunks = 4;
    for (let i = 0; i < chunks; i++) await db.insert(timeEntries).values({ userId: user.id, projectId: p.id, entryDate: d(h.done - 30 + i * 7), durationMinutes: Math.round((h.actual / chunks) * 60), source: "manual", billable: true });
  }
  // Some logged time on p1
  await db.insert(timeEntries).values([{ userId: user.id, projectId: p1.id, entryDate: d(-9), durationMinutes: 150, source: "manual", notes: "Site visit" }, { userId: user.id, projectId: p1.id, entryDate: d(-5), durationMinutes: 240, source: "manual", notes: "Gravity design" }, { userId: user.id, projectId: p1.id, entryDate: d(-1), durationMinutes: 90, source: "manual" }]);
  // A submitted estimate awaiting approval
  const [e2] = await db.insert(estimates).values({ projectId: p6.id, revision: 1, scopeKind: "original", status: "submitted", feeType: "hourly", hourlyRate: "150", totalHours: "20", totalFee: "3000", title: "Structural engineering for tenant improvement", preparedBy: user.id, submittedAt: new Date() }).returning();
  await db.insert(estimateLines).values([{ estimateId: e2.id, phase: "Design", description: "Design", hours: "8", rate: "150", amount: "1200", sortOrder: 0 }, { estimateId: e2.id, phase: "Drawings", description: "Drawings", hours: "8", rate: "150", amount: "1200", sortOrder: 1 }, { estimateId: e2.id, phase: "Submittal", description: "Calculations and review response", hours: "4", rate: "150", amount: "600", sortOrder: 2 }]);
  await audit(user.id, "demo.load", "system", null, "Loaded DEMO sample data");
  return ok({ message: "Sample data loaded: 3 clients, 9 projects (3 completed), 1 estimate awaiting approval. Try “Recommend schedule” on the Schedule page.", projects: [p1.id, p2.id, p3.id] });
});

export const DELETE = route(async () => {
  const user = await requireOwner();
  await assertSameOrigin();
  guard();
  const demoClients = await db.select({ id: clients.id }).from(clients).where(like(clients.name, `${DEMO}%`));
  for (const c of demoClients) {
    await db.delete(projects).where(eq(projects.clientId, c.id));
    await db.delete(clients).where(eq(clients.id, c.id));
  }
  await db.execute(sql`delete from work_blocks where project_id is null and title like ${DEMO + "%"}`);
  await audit(user.id, "demo.clear", "system", null, "Removed DEMO sample data");
  return ok({ message: `Removed ${demoClients.length} demo clients and their projects.` });
});
