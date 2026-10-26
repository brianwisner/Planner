import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { computeDayCapacity, mergeIntervals, resolveDayWindow } from "@/lib/engine/capacity";

const TZ = "America/Los_Angeles";
const rules = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 8 * 60, endMinute: 17 * 60, breakMinutes: 60 }));
const at = (date: string, hm: string) => DateTime.fromISO(`${date}T${hm}`, { zone: TZ }).toJSDate();

describe("capacity", () => {
  it("weekday window gives 9h gross, 8h net, 10% buffer", () => {
    const w = resolveDayWindow("2026-10-14", rules, [], TZ); // Wednesday
    const c = computeDayCapacity(w, [], TZ, 10);
    expect(c.grossHours).toBe(9);
    expect(c.breakHours).toBe(1);
    expect(c.availableHours).toBe(7.2);
  });
  it("weekend is off", () => {
    const w = resolveDayWindow("2026-10-17", rules, [], TZ); // Saturday
    expect(w.off).toBe(true);
    expect(computeDayCapacity(w, [], TZ, 10).availableHours).toBe(0);
  });
  it("exception overrides the rule", () => {
    const w = resolveDayWindow("2026-10-14", rules, [{ date: "2026-10-14", kind: "custom", startMinute: 9 * 60, endMinute: 12 * 60, breakMinutes: 0 }], TZ);
    expect(computeDayCapacity(w, [], TZ, 0).availableHours).toBe(3);
    const off = resolveDayWindow("2026-10-14", rules, [{ date: "2026-10-14", kind: "off", startMinute: null, endMinute: null, breakMinutes: null }], TZ);
    expect(off.off).toBe(true);
  });
  it("overlapping appointments are merged, not double counted", () => {
    const w = resolveDayWindow("2026-10-14", rules, [], TZ);
    const events = [
      { start: at("2026-10-14", "10:00"), end: at("2026-10-14", "11:00"), allDay: false, busy: true },
      { start: at("2026-10-14", "10:30"), end: at("2026-10-14", "12:00"), allDay: false, busy: true },
    ];
    const c = computeDayCapacity(w, events, TZ, 0);
    expect(c.eventHours).toBe(2); // 10:00–12:00 merged
    expect(c.availableHours).toBe(6);
  });
  it("events outside the working window are clipped", () => {
    const w = resolveDayWindow("2026-10-14", rules, [], TZ);
    const events = [{ start: at("2026-10-14", "06:00"), end: at("2026-10-14", "09:00"), allDay: false, busy: true }];
    const c = computeDayCapacity(w, events, TZ, 0);
    expect(c.eventHours).toBe(1);
  });
  it("free (transparent) and cancelled events do not reduce capacity", () => {
    const w = resolveDayWindow("2026-10-14", rules, [], TZ);
    const events = [
      { start: at("2026-10-14", "10:00"), end: at("2026-10-14", "11:00"), allDay: false, busy: false },
      { start: at("2026-10-14", "13:00"), end: at("2026-10-14", "14:00"), allDay: false, busy: true, status: "cancelled" },
    ];
    expect(computeDayCapacity(w, events, TZ, 0).availableHours).toBe(8);
  });
  it("busy all-day event zeroes the day", () => {
    const w = resolveDayWindow("2026-10-14", rules, [], TZ);
    const events = [{ start: at("2026-10-14", "00:00"), end: at("2026-10-15", "00:00"), allDay: true, busy: true }];
    const c = computeDayCapacity(w, events, TZ, 10);
    expect(c.allDayBusy).toBe(true);
    expect(c.availableHours).toBe(0);
  });
  it("handles the DST fall-back day correctly (window stays 9h local)", () => {
    // 2026-11-01 is the US DST end (25-hour day in LA).
    const w = resolveDayWindow("2026-11-02", rules, [], TZ); // Monday after
    const c = computeDayCapacity(w, [], TZ, 0);
    expect(c.grossHours).toBe(9);
    const sun = resolveDayWindow("2026-11-01", rules, [{ date: "2026-11-01", kind: "custom", startMinute: 0, endMinute: 24 * 60, breakMinutes: 0 }], TZ);
    const cs = computeDayCapacity(sun, [], TZ, 0);
    expect(cs.grossHours).toBe(25); // the real local day is 25h
    const work = resolveDayWindow("2026-11-01", rules, [{ date: "2026-11-01", kind: "custom", startMinute: 8 * 60, endMinute: 17 * 60, breakMinutes: 0 }], TZ);
    expect(computeDayCapacity(work, [], TZ, 0).grossHours).toBe(9); // 8:00–17:00 wall clock is still 9h (shift happens at 2am)
    const spring = resolveDayWindow("2026-03-08", rules, [{ date: "2026-03-08", kind: "custom", startMinute: 8 * 60, endMinute: 17 * 60, breakMinutes: 0 }], TZ);
    expect(computeDayCapacity(spring, [], TZ, 0).grossHours).toBe(9);
    const ev = [{ start: at("2026-11-01", "09:00"), end: at("2026-11-01", "10:00"), allDay: false, busy: true }];
    expect(computeDayCapacity(resolveDayWindow("2026-11-01", rules, [{ date: "2026-11-01", kind: "custom", startMinute: 8 * 60, endMinute: 17 * 60, breakMinutes: 0 }], TZ), ev, TZ, 0).eventHours).toBe(1);
  });
  it("mergeIntervals merges touching ranges", () => {
    expect(mergeIntervals([{ s: 0, e: 10 }, { s: 10, e: 20 }, { s: 30, e: 40 }])).toEqual([{ s: 0, e: 20 }, { s: 30, e: 40 }]);
  });
});
