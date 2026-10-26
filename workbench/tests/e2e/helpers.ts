import { expect, request, type APIRequestContext, type Page } from "@playwright/test";
import { DateTime } from "luxon";

export const BRIAN = { name: "Brian Wisner", email: "brian@example.com", password: "brian-test-password-1" };
export const ERIKA = { name: "Erika", email: "erika@example.com", password: "erika-test-password-1" };
export const TZ = "America/Los_Angeles";
export const today = () => DateTime.now().setZone(TZ).toISODate()!;
export const plusDays = (n: number) => DateTime.now().setZone(TZ).plus({ days: n }).toISODate()!;
/** Next weekday (Mon–Fri) at least n days out. */
export function nextWeekday(n = 1) {
  let d = DateTime.now().setZone(TZ).plus({ days: n });
  while (d.weekday > 5) d = d.plus({ days: 1 });
  return d.toISODate()!;
}

export async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/today/);
}

export async function apiAs(who: { email: string; password: string }): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100" });
  const r = await ctx.post("/api/auth/login", { data: { email: who.email, password: who.password } });
  if (!r.ok()) throw new Error(`login failed for ${who.email}: ${await r.text()}`);
  return ctx;
}

export async function json<T = Record<string, unknown>>(res: { json: () => Promise<unknown>; status: () => number; text: () => Promise<string> }, expected?: number): Promise<T> {
  if (expected !== undefined) {
    const s = res.status();
    if (s !== expected) throw new Error(`expected ${expected}, got ${s}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}
