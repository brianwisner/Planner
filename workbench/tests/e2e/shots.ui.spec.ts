import { test } from "@playwright/test";
import { BRIAN, apiAs, json, signIn } from "./helpers";

// Not a test: captures documentation screenshots with demo data loaded. Run with: npx playwright test shots --project=desktop --project=iphone
test("capture screenshots", async ({ page }, info) => {
  const brian = await apiAs(BRIAN);
  const existing = await json<{ clients: { name: string }[] }>(await brian.get("/api/clients"));
  if (!existing.clients.some((c) => c.name.startsWith("DEMO"))) {
    await json(await brian.post("/api/demo"), 200);
    await json(await brian.put("/api/availability/prefs", { data: { bufferPercent: 10 } }), 200);
    const gen = await json<{ proposal: { id: number } }>(await brian.post("/api/proposals/generate", { data: {} }), 201);
    await json(await brian.post(`/api/proposals/${gen.proposal.id}/accept`), 200);
    await json(await brian.post("/api/proposals/generate", { data: { includeTentative: true } }), 201); // leave one open proposal
  }
  const projects = await json<{ projects: { id: number; name: string }[] }>(await brian.get("/api/projects?status=all"));
  const p1 = projects.projects.find((p) => p.name.includes("Smith residence"))!;
  const ests = await json<{ estimates: { id: number; status: string }[] }>(await brian.get("/api/estimates?status=submitted"));
  const props = await json<{ proposals: { id: number }[] }>(await brian.get("/api/proposals?status=proposed"));
  await signIn(page, BRIAN);
  const dir = `docs/screenshots/${info.project.name}`;
  const shots: [string, string][] = [["/today", "today"], ["/schedule", "schedule"], [`/schedule/proposals/${props.proposals[0]?.id}`, "proposal"], [`/projects/${p1.id}`, "project"], [`/estimates/${ests.estimates[0]?.id}`, "estimate"], ["/estimates/new?projectId=" + p1.id, "estimate-editor"], ["/reports", "reports"], ["/time", "time"], ["/settings/hours", "settings-hours"], ["/schedule/whatif", "whatif"]];
  for (const [path, name] of shots) {
    await page.goto(path);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: info.project.name === "desktop" });
  }
});
