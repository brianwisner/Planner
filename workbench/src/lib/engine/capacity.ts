import { DateTime } from "luxon";

export type AvailabilityRule = { weekday: number; startMinute: number; endMinute: number; breakMinutes: number };
export type AvailabilityException = {
  date: string;
  kind: "off" | "custom";
  startMinute: number | null;
  endMinute: number | null;
  breakMinutes: number | null;
  note?: string | null;
};
export type BusyEvent = { start: Date; end: Date; allDay: boolean; busy: boolean; summary?: string | null; status?: string };
export type FixedBlock = { hours: number; locked?: boolean; kind?: "work" | "commitment" };

export type DayWindow = {
  date: string;
  off: boolean;
  startMinute: number;
  endMinute: number;
  breakMinutes: number;
  note?: string | null;
  source: "rule" | "exception" | "none";
};

export type DayCapacity = {
  date: string;
  off: boolean;
  note?: string | null;
  windowStart: number;
  windowEnd: number;
  grossHours: number; // window length
  breakHours: number;
  eventHours: number; // merged busy time inside the window
  bufferHours: number;
  availableHours: number; // what can be planned for project work
  allDayBusy: boolean;
  events: { summary: string; start: string; end: string; minutes: number; allDay: boolean }[];
};

export function resolveDayWindow(date: string, rules: AvailabilityRule[], exceptions: AvailabilityException[], tz: string): DayWindow {
  const exc = exceptions.find((e) => e.date === date);
  if (exc) {
    if (exc.kind === "off") return { date, off: true, startMinute: 0, endMinute: 0, breakMinutes: 0, note: exc.note, source: "exception" };
    return {
      date,
      off: false,
      startMinute: exc.startMinute ?? 0,
      endMinute: exc.endMinute ?? 0,
      breakMinutes: exc.breakMinutes ?? 0,
      note: exc.note,
      source: "exception",
    };
  }
  const weekday = DateTime.fromISO(date, { zone: tz }).weekday; // 1..7 Mon..Sun
  const rule = rules.find((r) => r.weekday === weekday);
  if (!rule || rule.endMinute <= rule.startMinute) return { date, off: true, startMinute: 0, endMinute: 0, breakMinutes: 0, source: rule ? "rule" : "none" };
  return { date, off: false, startMinute: rule.startMinute, endMinute: rule.endMinute, breakMinutes: rule.breakMinutes, source: "rule" };
}

/** Merge overlapping [start,end] intervals (ms) so overlapping appointments are not double counted. */
export function mergeIntervals(intervals: { s: number; e: number }[]): { s: number; e: number }[] {
  const sorted = intervals.filter((i) => i.e > i.s).sort((a, b) => a.s - b.s);
  const out: { s: number; e: number }[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.s <= last.e) last.e = Math.max(last.e, i.e);
    else out.push({ ...i });
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Capacity for one day. Working window is interpreted in `tz` (DST-safe via Luxon),
 * busy events are clipped to the window and merged before subtracting.
 */
export function computeDayCapacity(
  window: DayWindow,
  events: BusyEvent[],
  tz: string,
  bufferPercent: number,
): DayCapacity {
  const base: DayCapacity = {
    date: window.date,
    off: window.off,
    note: window.note,
    windowStart: window.startMinute,
    windowEnd: window.endMinute,
    grossHours: 0,
    breakHours: 0,
    eventHours: 0,
    bufferHours: 0,
    availableHours: 0,
    allDayBusy: false,
    events: [],
  };
  const dayStart = DateTime.fromISO(window.date, { zone: tz }).startOf("day");
  const dayEnd = dayStart.plus({ days: 1 });
  const relevant = events.filter((e) => e.busy && e.status !== "cancelled" && e.end.getTime() > dayStart.toMillis() && e.start.getTime() < dayEnd.toMillis());
  base.events = relevant.map((e) => ({
    summary: e.summary ?? "(busy)",
    start: e.start.toISOString(),
    end: e.end.toISOString(),
    minutes: Math.round((Math.min(e.end.getTime(), dayEnd.toMillis()) - Math.max(e.start.getTime(), dayStart.toMillis())) / 60000),
    allDay: e.allDay,
  }));
  if (window.off) return base;

  // Wall-clock times (DST-safe): 8:00 means 8:00 local even on days the clocks change.
  const wall = (m: number) => (m >= 1440 ? dayEnd : dayStart.set({ hour: Math.floor(m / 60), minute: m % 60 }));
  const wStart = wall(window.startMinute).toMillis();
  const wEnd = wall(window.endMinute).toMillis();
  base.grossHours = round2((wEnd - wStart) / 3600000);
  base.breakHours = round2(window.breakMinutes / 60);

  if (relevant.some((e) => e.allDay)) {
    base.allDayBusy = true;
    base.eventHours = base.grossHours;
    base.availableHours = 0;
    return base;
  }
  const clipped = relevant.map((e) => ({ s: Math.max(e.start.getTime(), wStart), e: Math.min(e.end.getTime(), wEnd) }));
  const merged = mergeIntervals(clipped);
  const busyMs = merged.reduce((s, i) => s + (i.e - i.s), 0);
  base.eventHours = round2(busyMs / 3600000);
  const net = Math.max(0, base.grossHours - base.eventHours - base.breakHours);
  base.bufferHours = round2((net * Math.min(Math.max(bufferPercent, 0), 90)) / 100);
  base.availableHours = round2(Math.max(0, net - base.bufferHours));
  return base;
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let d = DateTime.fromISO(from);
  const end = DateTime.fromISO(to);
  while (d <= end) {
    out.push(d.toISODate()!);
    d = d.plus({ days: 1 });
  }
  return out;
}
