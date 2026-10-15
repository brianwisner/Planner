import { test, expect, type APIRequestContext } from "@playwright/test";
import { execSync } from "node:child_process";
import { BRIAN, ERIKA, apiAs, json, nextWeekday, plusDays, signIn, today } from "./helpers";

let brian: APIRequestContext;
let erika: APIRequestContext;
let clientId: number;

test.beforeAll(async () => {
  brian = await apiAs(BRIAN);
  erika = await apiAs(ERIKA);
  const c = await json<{ client: { id: number } }>(await brian.post("/api/clients", { data: { name: "Rules Client", email: "rules@example.com" } }), 201);
  clientId = c.client.id;
});

async function makeProject(ctx: APIRequestContext, data: Record<string, unknown>) {
  const r = await json<{ project: { id: number } }>(await ctx.post("/api/projects", { data: { clientId, applyTemplate: false, ...data } }), 201);
  return r.project.id;
}

// Scenario 2: Erika prepares, only Brian approves.
test("Erika can prepare and submit an estimate but cannot approve it; Brian can", async () => {
  const pid = await makeProject(erika, { name: "Approval test", status: "accepted" });
  const e = await json<{ estimate: { id: number } }>(await erika.post("/api/estimates", { data: { projectId: pid, feeType: "hourly", hourlyRate: 150, lines: [{ description: "Design", hours: 10 }] } }), 201);
  await json(await erika.post(`/api/estimates/${e.estimate.id}/submit`), 200);
  const denied = await erika.post(`/api/estimates/${e.estimate.id}/approve`, { data: { note: "trying" } });
  expect(denied.status()).toBe(403);
  const ok = await json<{ estimate: { status: string } }>(await brian.post(`/api/estimates/${e.estimate.id}/approve`, { data: {} }), 200);
  expect(ok.estimate.status).toBe("approved");
  const p = await json<{ project: { estimatedHours: string; feeAmount: string } }>(await brian.get(`/api/projects/${pid}`));
  expect(Number(p.project.estimatedHours)).toBe(10);
  expect(Number(p.project.feeAmount)).toBe(1500);
  const hist = await json<{ entries: { action: string; userName: string }[] }>(await brian.get(`/api/audit?entityType=estimate&entityId=${e.estimate.id}`));
  expect(hist.entries.some((h) => h.action === "estimate.approve" && h.userName === BRIAN.name)).toBe(true);
});

// Scenario 3: working hours + calendar appointments → capacity (overlaps not double counted).
test("daily working hours and calendar appointments determine capacity", async () => {
  const me = await json<{ user: { id: number } }>(await brian.get("/api/auth/me"));
  const day = nextWeekday(3);
  await json(await brian.put("/api/availability/rules", { data: { rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 8 * 60, endMinute: 17 * 60, breakMinutes: 60 })) } }), 200);
  await json(await brian.put("/api/availability/prefs", { data: { bufferPercent: 0 } }), 200);
  // Simulate a synced Google calendar with two overlapping busy events, one free event, and one app-published block.
  const db = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/workbench";
  const sql = `
    insert into google_accounts (user_id, google_email, scopes, status) values (${me.user.id}, 'brian@example.com', 'https://www.googleapis.com/auth/calendar.readonly', 'connected') on conflict (user_id) do nothing;
    insert into calendars (google_account_id, google_calendar_id, summary, affects_availability) select id, 'primary', 'Primary', true from google_accounts where user_id=${me.user.id} on conflict do nothing;
    insert into calendar_events (calendar_id, google_event_id, summary, start_at, end_at, all_day, busy, status, is_app_block)
      select c.id, 'ev1', 'Site visit', '${day} 10:00-07'::timestamptz, '${day} 11:00-07'::timestamptz, false, true, 'confirmed', false from calendars c where c.google_calendar_id='primary'
      union all select c.id, 'ev2', 'Overlapping call', '${day} 10:30-07'::timestamptz, '${day} 12:00-07'::timestamptz, false, true, 'confirmed', false from calendars c where c.google_calendar_id='primary'
      union all select c.id, 'ev3', 'Free reminder', '${day} 13:00-07'::timestamptz, '${day} 14:00-07'::timestamptz, false, false, 'confirmed', false from calendars c where c.google_calendar_id='primary'
      union all select c.id, 'ev4', 'Work: published block', '${day} 14:00-07'::timestamptz, '${day} 16:00-07'::timestamptz, false, true, 'confirmed', true from calendars c where c.google_calendar_id='primary'
    on conflict (calendar_id, google_event_id) do nothing;`;
  execSync(`psql "${db}" -q -c "${sql.replace(/"/g, '\\"')}"`);
  const s = await json<{ days: { date: string; availableHours: number; eventHours: number; grossHours: number }[] }>(await brian.get(`/api/schedule?from=${day}&to=${day}`));
  const d = s.days[0];
  expect(d.grossHours).toBe(9);
  // Offsets above assume PDT (-07). In PST the window math is identical because events are stored absolute and 10:00-07 = 09:00 PST, still inside the window.
  expect(d.eventHours).toBe(2); // 10:00–12:00 merged; free and app-published events ignored
  expect(d.availableHours).toBe(6); // 9 − 1 break − 2 events
});

// Scenario 4 + 5: recommendation is a proposal; locked work survives.
test("recommendations do not change the approved schedule until Brian accepts; locked blocks survive", async () => {
  const pid = await makeProject(brian, { name: "Sched A", status: "accepted", estimatedHours: 12, priority: 2, clientDueDate: plusDays(30) });
  const lockDay = nextWeekday(5);
  const lock = await json<{ block: { id: number } }>(await brian.post("/api/blocks", { data: { projectId: pid, date: lockDay, hours: 2, locked: true } }), 201);
  const before = await json<{ days: { blocks: { id: number }[] }[] }>(await brian.get(`/api/schedule?from=${today()}&to=${plusDays(41)}`));
  const beforeIds = before.days.flatMap((d) => d.blocks.map((b) => b.id)).sort();

  // Erika generates a proposal.
  const gen = await json<{ proposal: { id: number; status: string; blocks: { projectId: number; existingId?: number; locked?: boolean; date: string; hours: number }[]; summary: { moves: unknown[] } } }>(await erika.post("/api/proposals/generate", { data: {} }), 201);
  expect(gen.proposal.status).toBe("proposed");
  expect(gen.proposal.blocks.some((b) => b.existingId === lock.block.id && b.locked && b.date === lockDay && b.hours === 2)).toBe(true);
  // Approved schedule unchanged.
  const mid = await json<{ days: { blocks: { id: number }[] }[] }>(await brian.get(`/api/schedule?from=${today()}&to=${plusDays(41)}`));
  expect(mid.days.flatMap((d) => d.blocks.map((b) => b.id)).sort()).toEqual(beforeIds);
  // Erika cannot accept.
  expect((await erika.post(`/api/proposals/${gen.proposal.id}/accept`)).status()).toBe(403);
  // Brian accepts.
  await json(await brian.post(`/api/proposals/${gen.proposal.id}/accept`), 200);
  const after = await json<{ days: { blocks: { id: number; projectId: number; locked: boolean; hours: string }[] }[] }>(await brian.get(`/api/schedule?from=${today()}&to=${plusDays(41)}`));
  const blocks = after.days.flatMap((d) => d.blocks);
  expect(blocks.find((b) => b.id === lock.block.id)?.locked).toBe(true);
  const total = blocks.filter((b) => b.projectId === pid).reduce((s, b) => s + Number(b.hours), 0);
  expect(total).toBe(12);
  // Undo restores.
  await json(await brian.post(`/api/proposals/${gen.proposal.id}/undo`), 200);
  const undone = await json<{ days: { blocks: { id: number }[] }[] }>(await brian.get(`/api/schedule?from=${today()}&to=${plusDays(41)}`));
  expect(undone.days.flatMap((d) => d.blocks.map((b) => b.id)).sort()).toEqual(beforeIds);
});

// Scenario 6: manual scheduling with conflict warnings; Erika cannot touch the approved schedule.
test("manual scheduling warns on conflicts and never silently moves other work", async () => {
  const pid = await makeProject(brian, { name: "Manual", status: "accepted", estimatedHours: 20 });
  const day = nextWeekday(7);
  await json(await brian.post("/api/blocks", { data: { projectId: pid, date: day, hours: 5 } }), 201);
  const conflict = await brian.post("/api/blocks", { data: { projectId: pid, date: day, hours: 4 } });
  expect(conflict.status()).toBe(409);
  const body = await conflict.json();
  expect(body.conflict.overbooked).toBe(true);
  expect(body.error).toMatch(/overbooks/);
  await json(await brian.post("/api/blocks", { data: { projectId: pid, date: day, hours: 4, confirmOverbook: true } }), 201);
  const s = await json<{ days: { blocks: { hours: string }[]; overbooked: boolean; overbookedBy: number }[] }>(await brian.get(`/api/schedule?from=${day}&to=${day}`));
  expect(s.days[0].blocks.length).toBe(2); // nothing was moved away
  expect(s.days[0].overbooked).toBe(true);
  const weekend = (() => { let d = today(); for (let i = 1; i < 9; i++) { const x = plusDays(i); if (new Date(x + "T12:00:00").getDay() === 6) { d = x; break; } } return d; })();
  const off = await brian.post("/api/blocks", { data: { projectId: pid, date: weekend, hours: 1 } });
  expect(off.status()).toBe(409);
  expect((await off.json()).error).toMatch(/not a working day/);
  expect((await erika.post("/api/blocks", { data: { projectId: pid, date: day, hours: 1 } })).status()).toBe(403);
});

// Scenario 7: what-if does not touch the live schedule.
test("what-if scenarios never change the live schedule", async () => {
  const before = await json<{ days: { blocks: { id: number; hours: string }[] }[] }>(await brian.get(`/api/schedule?from=${today()}&to=${plusDays(41)}`));
  const snap = JSON.stringify(before.days.map((d) => d.blocks.map((b) => [b.id, b.hours])));
  const sc = await json<{ scenario: { id: number } }>(await erika.post("/api/scenarios", { data: { name: "Push everything", overrides: { capacity: { extraHoursPerDay: 3, maxConcurrentProjects: 5 } } } }), 201);
  const run = await json<{ whatIf: { blocks: unknown[] }; baseline: unknown }>(await erika.post(`/api/scenarios/${sc.scenario.id}/run`), 200);
  expect(run.whatIf.blocks.length).toBeGreaterThan(0);
  const after = await json<{ days: { blocks: { id: number; hours: string }[] }[] }>(await brian.get(`/api/schedule?from=${today()}&to=${plusDays(41)}`));
  expect(JSON.stringify(after.days.map((d) => d.blocks.map((b) => [b.id, b.hours])))).toBe(snap);
});

// Scenario 8 + 9: changes visible across accounts/devices; concurrent edits do not silently overwrite.
test("changes appear across accounts and stale edits are rejected", async ({ browser }) => {
  const pid = await makeProject(erika, { name: "Shared project", status: "accepted" });
  const a = await json<{ project: { version: number } }>(await brian.get(`/api/projects/${pid}`));
  const b = await json<{ project: { version: number } }>(await erika.get(`/api/projects/${pid}`));
  expect(a.project.version).toBe(b.project.version);
  // Erika saves first.
  await json(await erika.patch(`/api/projects/${pid}`, { data: { notes: "Erika's note", version: b.project.version } }), 200);
  // Brian saves with the stale version → 409 with current copy.
  const stale = await brian.patch(`/api/projects/${pid}`, { data: { notes: "Brian's note", version: a.project.version } });
  expect(stale.status()).toBe(409);
  const body = await stale.json();
  expect(body.current.notes).toBe("Erika's note");
  // Fresh version succeeds, and both see it.
  await json(await brian.patch(`/api/projects/${pid}`, { data: { priority: 1, version: body.current.version } }), 200);
  const seen = await json<{ project: { priority: number; notes: string } }>(await erika.get(`/api/projects/${pid}`));
  expect(seen.project.priority).toBe(1);
  expect(seen.project.notes).toBe("Erika's note");
  // Second browser context (another device) sees the project.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, ERIKA);
  await page.goto(`/projects/${pid}`);
  await expect(page.getByText("Erika's note")).toBeVisible();
  await expect(page.getByText("Urgent").first()).toBeVisible();
  await ctx.close();
});

// Scenario 10: timers survive browser restarts and devices; one running timer per user.
test("timers are server-side, survive new contexts, and never duplicate", async ({ browser }) => {
  const pid = await makeProject(brian, { name: "Timer project", status: "in_progress" });
  const ctx1 = await browser.newContext();
  const page1 = await ctx1.newPage();
  await signIn(page1, BRIAN);
  await page1.goto(`/projects/${pid}`);
  await page1.getByRole("button", { name: "▶ Start timer" }).click();
  await expect(page1.getByRole("button", { name: "Stop" })).toBeVisible();
  await ctx1.close(); // "close the tab / restart browser"
  const cur = await json<{ timer: { projectId: number; startedAt: string } | null }>(await brian.get("/api/timers/current"));
  expect(cur.timer?.projectId).toBe(pid);
  // Second device sees the running timer.
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await signIn(page2, BRIAN);
  await expect(page2.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(page2.getByText("Timer project").first()).toBeVisible();
  // Starting another timer switches (stops the first) rather than duplicating.
  const pid2 = await makeProject(brian, { name: "Timer project 2", status: "in_progress" });
  const sw = await json<{ timer: { projectId: number }; stopped: { projectId: number } | null }>(await brian.post("/api/timers/start", { data: { projectId: pid2 } }), 201);
  expect(sw.timer.projectId).toBe(pid2);
  expect(sw.stopped?.projectId).toBe(pid);
  const entries = await json<{ entries: { endedAt: string | null; startedAt: string | null }[] }>(await brian.get(`/api/time?from=${today()}&to=${today()}`));
  expect(entries.entries.filter((e) => e.startedAt && !e.endedAt).length).toBe(1);
  // Database-level guarantee: a second running row for the same user is rejected.
  const db = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/workbench";
  let dbErr = "";
  try {
    execSync(`psql "${db}" -q -v ON_ERROR_STOP=1 -c "insert into time_entries (user_id, project_id, entry_date, started_at, duration_minutes, source) select user_id, project_id, entry_date, now(), 0, 'timer' from time_entries where ended_at is null and started_at is not null limit 1"`, { stdio: "pipe" });
  } catch (e) {
    dbErr = String((e as { stderr?: Buffer }).stderr ?? e);
  }
  expect(dbErr).toMatch(/time_one_running_per_user/);
  await json(await brian.post("/api/timers/stop"), 200);
  await ctx2.close();
});

// Scenario 11: estimate recommendations with no / limited history.
test("estimate recommendations are honest about missing history", async () => {
  const types = await json<{ projectTypes: { id: number; name: string; defaultHours: string | null }[] }>(await brian.get("/api/project-types"));
  const other = types.projectTypes.find((t) => t.name === "Other")!;
  const deck = types.projectTypes.find((t) => t.name.startsWith("Deck"))!;
  const p1 = await makeProject(brian, { name: "No-history", projectTypeId: other.id });
  const r1 = await json<{ recommendation: { basis: string; comparableCount: number; hours: unknown } }>(await brian.get(`/api/estimates/recommend?projectId=${p1}`));
  expect(r1.recommendation.basis).toBe("none");
  expect(r1.recommendation.hours).toBeNull();
  const p2 = await makeProject(brian, { name: "Template-only", projectTypeId: deck.id });
  const r2 = await json<{ recommendation: { basis: string; evidence: string; assumptions: string[] } }>(await brian.get(`/api/estimates/recommend?projectId=${p2}`));
  expect(r2.recommendation.basis).toBe("template");
  expect(r2.recommendation.evidence).toBe("none");
  expect(r2.recommendation.assumptions[0]).toMatch(/not a data-driven/);
  // One completed deck with time → weak evidence, names the comparable.
  const done = await makeProject(brian, { name: "Done deck", projectTypeId: deck.id, status: "completed", estimatedHours: 7 });
  await json(await brian.post("/api/time", { data: { projectId: done, entryDate: today(), durationMinutes: 480 } }), 201);
  const r3 = await json<{ recommendation: { basis: string; evidence: string; comparableCount: number; comparables: { name: string }[]; hours: { mid: number } } }>(await brian.get(`/api/estimates/recommend?projectId=${p2}`));
  expect(r3.recommendation.basis).toBe("history");
  expect(r3.recommendation.evidence).toBe("weak");
  expect(r3.recommendation.comparableCount).toBe(1);
  expect(r3.recommendation.comparables[0].name).toBe("Done deck");
  expect(r3.recommendation.hours.mid).toBe(8);
});

// Scenario 12: calendar updates do not create duplicates or loops (storage-level guarantees).
test("calendar events are de-duplicated and app-published blocks are never counted as busy", async () => {
  const db = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/workbench";
  const day = nextWeekday(9);
  const upsert = `insert into calendar_events (calendar_id, google_event_id, summary, start_at, end_at, all_day, busy, status, is_app_block) select c.id, 'dup1', 'Dup', '${day} 09:00-07'::timestamptz, '${day} 10:00-07'::timestamptz, false, true, 'confirmed', false from calendars c where c.google_calendar_id='primary' on conflict (calendar_id, google_event_id) do update set summary = excluded.summary`;
  execSync(`psql "${db}" -q -c "${upsert}"`);
  execSync(`psql "${db}" -q -c "${upsert}"`);
  const count = execSync(`psql "${db}" -tA -c "select count(*) from calendar_events where google_event_id='dup1'"`).toString().trim();
  expect(count).toBe("1");
  const s = await json<{ days: { eventHours: number }[] }>(await brian.get(`/api/schedule?from=${day}&to=${day}`));
  expect(s.days[0].eventHours).toBe(1);
  // Cancelled events are ignored.
  execSync(`psql "${db}" -q -c "update calendar_events set status='cancelled' where google_event_id='dup1'"`);
  const s2 = await json<{ days: { eventHours: number }[] }>(await brian.get(`/api/schedule?from=${day}&to=${day}`));
  expect(s2.days[0].eventHours).toBe(0);
});

// Permissions beyond estimates: staff cannot change settings owned by the owner.
test("server-side authorization holds for owner-only actions", async () => {
  expect((await erika.post("/api/project-types", { data: { name: "Hack" } })).status()).toBe(403);
  expect((await erika.post("/api/rates", { data: { name: "Hack", rate: 1 } })).status()).toBe(403);
  expect((await erika.post("/api/users", { data: { name: "X", email: "x@example.com", password: "0123456789ab" } })).status()).toBe(403);
  expect((await erika.post("/api/google/publish", { data: {} })).status()).toBe(403);
  const anon = await (await import("@playwright/test")).request.newContext({ baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100" });
  expect((await anon.get("/api/projects")).status()).toBe(401);
  await anon.dispose();
});

// Export works.
test("exports return CSV and JSON", async () => {
  const csv = await brian.get("/api/export?what=projects&format=csv");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect((await csv.text()).split("\n")[0]).toContain("name");
  const all = await brian.get("/api/export?what=all");
  expect((await all.json()).projects.length).toBeGreaterThan(0);
});
