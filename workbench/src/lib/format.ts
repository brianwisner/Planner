import { DateTime } from "luxon";

export const DEFAULT_TZ = process.env.DEFAULT_TIMEZONE || "America/Los_Angeles";

export function fmtHours(h: number | string | null | undefined, digits = 1) {
  if (h == null || h === "") return "–";
  const n = typeof h === "string" ? Number(h) : h;
  if (!Number.isFinite(n)) return "–";
  return `${n.toFixed(digits).replace(/\.0$/, "")} h`;
}
export function fmtMoney(v: number | string | null | undefined) {
  if (v == null || v === "") return "–";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "–";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
export function fmtDate(d: string | Date | null | undefined, tz = DEFAULT_TZ) {
  if (!d) return "–";
  const dt = typeof d === "string" ? (d.length === 10 ? DateTime.fromISO(d, { zone: tz }) : DateTime.fromISO(d).setZone(tz)) : DateTime.fromJSDate(d).setZone(tz);
  return dt.isValid ? dt.toFormat("LLL d, yyyy") : "–";
}
export function fmtDateShort(d: string | null | undefined, tz = DEFAULT_TZ) {
  if (!d) return "–";
  const dt = DateTime.fromISO(d, { zone: tz });
  return dt.isValid ? dt.toFormat("EEE LLL d") : "–";
}
export function fmtDateTime(d: string | Date | null | undefined, tz = DEFAULT_TZ) {
  if (!d) return "–";
  const dt = typeof d === "string" ? DateTime.fromISO(d).setZone(tz) : DateTime.fromJSDate(d).setZone(tz);
  return dt.isValid ? dt.toFormat("LLL d, yyyy h:mm a") : "–";
}
export function fmtMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}
export function todayISO(tz = DEFAULT_TZ) {
  return DateTime.now().setZone(tz).toISODate()!;
}
export function num(v: number | string | null | undefined, fallback = 0) {
  if (v == null || v === "") return fallback;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : fallback;
}
export const PRIORITY_LABELS: Record<number, string> = { 1: "Urgent", 2: "High", 3: "Normal", 4: "Low" };
export const STATUS_LABELS: Record<string, string> = {
  inquiry: "Inquiry",
  proposed: "Proposed",
  accepted: "Accepted",
  in_progress: "In progress",
  on_hold: "On hold",
  completed: "Completed",
  declined: "Declined",
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Returned",
  superseded: "Superseded",
  proposed_schedule: "Proposed",
  undone: "Undone",
  open: "Open",
  resolved: "Resolved",
  archived: "Archived",
};
