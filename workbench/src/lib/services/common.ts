import { z } from "zod";

/** Accepts number or numeric string; stores as string for numeric columns. */
export const zNum = z.union([z.number(), z.string()]).nullable().optional();
export function numStr(v: number | string | null | undefined): string | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) throw new Error("Invalid number");
  return String(Math.round(n * 100) / 100);
}
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable().optional();
export const zText = z.string().max(20000).nullable().optional();
export function clean<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}
