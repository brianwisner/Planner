import { test, expect } from "@playwright/test";
import { BRIAN, signIn, nextWeekday } from "./helpers";

// Scenario 1 (client → project → estimate → tasks → time) and 13 (desktop / iPhone / iPad), 6 (manual scheduling with warnings).
test.describe("core workflow in the browser", () => {
  test("create client, project, tasks, estimate and time; navigate on every device size", async ({ page }, testInfo) => {
    const tag = `${testInfo.project.name}`;
    page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) console.log("API-ERR", r.status(), r.url()); });
    await signIn(page, BRIAN);
    await expect(page.getByRole("heading", { name: /Good (morning|afternoon)/ })).toBeVisible();

    // Client
    await page.goto("/clients/new");
    await page.getByLabel("Client name *").fill(`UI Client ${tag}`);
    await page.getByLabel("Email").fill(`ui-${tag}@example.com`);
    await page.getByLabel("Phone").fill("503-555-0199");
    await page.getByRole("button", { name: "Create client" }).click();
    await expect(page).toHaveURL(/\/clients\/\d+/);
    await expect(page.getByRole("heading", { name: `UI Client ${tag}` })).toBeVisible();

    // Project from a template
    await page.getByRole("link", { name: "New project" }).first().click();
    await expect(page).toHaveURL(/\/projects\/new\?clientId=\d+/);
    await page.getByLabel("Project name *").fill(`UI Deck ${tag}`);
    await page.getByLabel("Project address").fill("1 Test St, Astoria, OR");
    await page.getByLabel("Project type").selectOption({ label: "Deck / porch / cover" });
    await page.getByLabel("Status").selectOption("accepted");
    await page.getByLabel("Client due date").fill(nextWeekday(20));
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/\d+$/);
    const projectUrl = page.url();
    // Template tasks were applied
    await expect(page.getByText("Plan and details")).toBeVisible();
    await expect(page.getByText("7 h", { exact: false }).first()).toBeVisible();

    // Add a task and complete one
    await page.getByPlaceholder("Add a task or milestone").fill("Client call");
    await page.getByRole("button", { name: "Add", exact: true }).first().click();
    await expect(page.getByText("Client call").first()).toBeVisible();
    await page.getByLabel("Mark Design done").check();
    await expect(page.getByLabel("Mark Design done")).toBeChecked();

    // Log time manually
    await page.getByRole("button", { name: "Log time" }).first().click();
    await page.getByLabel("Hours").fill("1.5");
    await page.getByLabel("Notes").fill("Site measurements");
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(page.getByText("1h 30m")).toBeVisible();

    // Start and stop a timer from the project page
    await page.getByRole("button", { name: "▶ Start timer" }).click();
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByRole("button", { name: "Stop" })).toBeHidden();

    // Estimate
    await page.goto(projectUrl);
    await page.getByRole("link", { name: "New estimate" }).first().click();
    await expect(page).toHaveURL(/\/estimates\/new\?projectId=\d+/);
    await expect(page.getByRole("heading", { name: "Similar completed projects" })).toBeVisible();
    await expect(page.getByText(/template default|evidence|no basis/).first()).toBeVisible(); // labels its basis honestly
    await page.getByRole("button", { name: "Import project tasks" }).click();
    await expect(page.locator("input[value=\"Plan and details\"]")).toBeVisible();
    await page.getByRole("button", { name: "Save & submit for approval" }).click();
    await expect(page).toHaveURL(/\/estimates\/\d+$/);
    await expect(page.getByText("Submitted", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await page.getByRole("button", { name: "Approve" }).last().click();
    await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();

    // Manual scheduling: add a block, then overbook and get a warning
    await page.goto("/schedule");
    await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
    const addButtons = page.getByRole("button", { name: "+ Add work" });
    await expect(addButtons.first()).toBeVisible();
    // pick the first future working day card's add button
    await addButtons.nth(1).click();
    await page.getByLabel("Project").selectOption({ index: 1 });
    await page.getByLabel("Date").fill(nextWeekday(2));
    await page.getByLabel("Hours").fill("3");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    // Earlier tests may already have filled this day; if so the conflict dialog is the correct behavior.
    await expect(page.getByRole("heading", { name: "Add to schedule" })).toBeHidden();
    const maybeConflict = page.getByRole("button", { name: "Do it anyway" });
    if (await maybeConflict.isVisible({ timeout: 3000 }).catch(() => false)) {
      await maybeConflict.click();
      await expect(maybeConflict).toBeHidden();
    }
    await expect(page.getByText(/3 h/).first()).toBeVisible();
    // overbook same day
    await addButtons.nth(1).click();
    await page.getByLabel("Project").selectOption({ index: 1 });
    await page.getByLabel("Date").fill(nextWeekday(2));
    await page.getByLabel("Hours").fill("8");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText(/overbooks/)).toBeVisible();
    await page.getByRole("button", { name: "Do it anyway" }).click();
    await expect(page.getByText(/Overbooked by/).first()).toBeVisible();

    // Navigation works on this device
    const narrow = (page.viewportSize()?.width ?? 1440) < 768; // phone layout uses the bottom tab bar; tablets get the sidebar
    if (narrow) {
      await page.getByRole("link", { name: "More" }).click();
      await page.getByRole("link", { name: "Reports" }).click();
    } else {
      await page.getByRole("link", { name: "Reports" }).click();
    }
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
    // no horizontal overflow on small screens
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
