import { google, type calendar_v3 } from "googleapis";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/lib/db";
import { calendarEvents, calendars, googleAccounts, projects, workBlocks } from "@/lib/db/schema";
import { authorizedClient, describeGoogleError, recordError } from "./client";
import { num } from "@/lib/format";

export const APP_EVENT_KEY = "wisnerWorkbenchBlock";

export async function refreshCalendarList(userId: number) {
  const { client, account } = await authorizedClient(userId);
  const cal = google.calendar({ version: "v3", auth: client });
  const res = await cal.calendarList.list({ minAccessRole: "reader", showHidden: false });
  const items = res.data.items ?? [];
  for (const c of items) {
    if (!c.id) continue;
    await db
      .insert(calendars)
      .values({ googleAccountId: account.id, googleCalendarId: c.id, summary: c.summaryOverride ?? c.summary ?? c.id, isPrimary: !!c.primary, accessRole: c.accessRole ?? null })
      .onConflictDoUpdate({ target: [calendars.googleAccountId, calendars.googleCalendarId], set: { summary: c.summaryOverride ?? c.summary ?? c.id, isPrimary: !!c.primary, accessRole: c.accessRole ?? null } });
  }
  await db.update(googleAccounts).set({ status: "connected", lastError: null, updatedAt: new Date() }).where(eq(googleAccounts.id, account.id));
  return items.length;
}

function toRow(calendarId: number, ev: calendar_v3.Schema$Event, tz: string) {
  const allDay = !!ev.start?.date;
  const startAt = allDay ? DateTime.fromISO(ev.start!.date!, { zone: tz }).startOf("day").toJSDate() : new Date(ev.start!.dateTime!);
  const endAt = allDay ? DateTime.fromISO(ev.end!.date!, { zone: tz }).startOf("day").toJSDate() : new Date(ev.end!.dateTime!);
  return {
    calendarId,
    googleEventId: ev.id!,
    summary: ev.summary ?? null,
    startAt,
    endAt,
    allDay,
    busy: ev.transparency !== "transparent",
    status: ev.status ?? "confirmed",
    recurringEventId: ev.recurringEventId ?? null,
    isAppBlock: !!ev.extendedProperties?.private?.[APP_EVENT_KEY],
    updatedAt: new Date(),
  };
}

/**
 * Incremental sync for one calendar using Google sync tokens.
 * Recurring events are expanded (singleEvents) so exceptions and cancellations are exact;
 * a 410 response means the token expired and a full resync is performed.
 */
export async function syncCalendar(userId: number, calendarRowId: number, tz: string) {
  const { client } = await authorizedClient(userId);
  const api = google.calendar({ version: "v3", auth: client });
  const [row] = await db.select().from(calendars).where(eq(calendars.id, calendarRowId));
  if (!row) throw new Error("Calendar not found");
  let syncToken = row.syncToken ?? undefined;
  let pageToken: string | undefined;
  let upserts = 0;
  let removed = 0;
  let full = !syncToken;
  for (let guard = 0; guard < 50; guard++) {
    let res;
    try {
      res = await api.events.list({
        calendarId: row.googleCalendarId,
        singleEvents: true,
        maxResults: 2500,
        showDeleted: true,
        pageToken,
        ...(syncToken ? { syncToken } : { timeMin: DateTime.now().minus({ days: 30 }).toISO()! }),
      });
    } catch (e) {
      const status = (e as { code?: number }).code;
      if (status === 410 && syncToken) {
        // Token expired: wipe and resync from scratch.
        await db.delete(calendarEvents).where(eq(calendarEvents.calendarId, row.id));
        syncToken = undefined;
        pageToken = undefined;
        full = true;
        continue;
      }
      throw e;
    }
    const items = res.data.items ?? [];
    const cancelled = items.filter((e) => e.status === "cancelled" && e.id).map((e) => e.id!);
    if (cancelled.length) {
      const del = await db.delete(calendarEvents).where(and(eq(calendarEvents.calendarId, row.id), inArray(calendarEvents.googleEventId, cancelled))).returning({ id: calendarEvents.id });
      removed += del.length;
    }
    const live = items.filter((e) => e.status !== "cancelled" && e.id && e.start && e.end && (e.start.dateTime || e.start.date));
    for (const ev of live) {
      const r = toRow(row.id, ev, tz);
      await db
        .insert(calendarEvents)
        .values(r)
        .onConflictDoUpdate({ target: [calendarEvents.calendarId, calendarEvents.googleEventId], set: { summary: r.summary, startAt: r.startAt, endAt: r.endAt, allDay: r.allDay, busy: r.busy, status: r.status, recurringEventId: r.recurringEventId, isAppBlock: r.isAppBlock, updatedAt: r.updatedAt } });
      upserts++;
    }
    if (res.data.nextPageToken) {
      pageToken = res.data.nextPageToken;
      continue;
    }
    await db.update(calendars).set({ syncToken: res.data.nextSyncToken ?? null, lastSyncedAt: new Date(), lastError: null }).where(eq(calendars.id, row.id));
    break;
  }
  return { upserts, removed, full };
}

export async function syncSelectedCalendars(userId: number, tz: string) {
  const { account } = await authorizedClient(userId);
  const rows = await db.select().from(calendars).where(and(eq(calendars.googleAccountId, account.id), eq(calendars.affectsAvailability, true)));
  const results: { calendar: string; upserts?: number; removed?: number; error?: string }[] = [];
  for (const c of rows) {
    try {
      const r = await syncCalendar(userId, c.id, tz);
      results.push({ calendar: c.summary, ...r });
    } catch (e) {
      const msg = describeGoogleError(e);
      await db.update(calendars).set({ lastError: msg }).where(eq(calendars.id, c.id));
      results.push({ calendar: c.summary, error: msg });
    }
  }
  const anyError = results.find((r) => r.error);
  await recordError(account.id, "lastError", anyError ? `Calendar sync: ${anyError.error}` : null);
  if (!anyError) await db.update(googleAccounts).set({ status: "connected", updatedAt: new Date() }).where(eq(googleAccounts.id, account.id));
  return results;
}

/**
 * Publishes approved work blocks to the write-back calendar as "free" events tagged with the block id.
 * - creates missing events, updates changed ones, deletes events for blocks that no longer exist;
 * - published events are tagged and excluded from capacity, so they are never double-counted.
 */
export async function publishBlocks(userId: number, from: string, to: string, tz: string) {
  const { client, account } = await authorizedClient(userId);
  if (!account.writebackCalendarId) throw new Error("Calendar write-back is not enabled");
  const api = google.calendar({ version: "v3", auth: client });
  const calId = account.writebackCalendarId;
  const blocks = await db
    .select({ block: workBlocks, projectName: projects.name })
    .from(workBlocks)
    .leftJoin(projects, eq(projects.id, workBlocks.projectId))
    .where(and(eq(workBlocks.userId, userId), gte(workBlocks.date, from), lte(workBlocks.date, to)));
  // Existing published events in range tagged by this app.
  const existing = await api.events.list({
    calendarId: calId,
    privateExtendedProperty: [`${APP_EVENT_KEY}=1`],
    timeMin: DateTime.fromISO(from, { zone: tz }).startOf("day").toISO()!,
    timeMax: DateTime.fromISO(to, { zone: tz }).endOf("day").toISO()!,
    singleEvents: true,
    maxResults: 2500,
    showDeleted: false,
  });
  const byBlockId = new Map<string, calendar_v3.Schema$Event>();
  for (const ev of existing.data.items ?? []) {
    const bid = ev.extendedProperties?.private?.blockId;
    if (bid) byBlockId.set(bid, ev);
  }
  let created = 0, updated = 0, deleted = 0;
  const seen = new Set<string>();
  for (const { block, projectName } of blocks) {
    const hours = num(block.hours);
    const title = `${block.kind === "commitment" ? "" : "Work: "}${block.title ?? projectName ?? "Work block"} (${hours} h)`;
    const body: calendar_v3.Schema$Event = {
      summary: title,
      description: block.note ?? "Scheduled in Wisner Workbench. Edit the schedule in Workbench; changes made here are overwritten on the next publish.",
      transparency: "transparent",
      extendedProperties: { private: { [APP_EVENT_KEY]: "1", blockId: String(block.id) } },
    };
    if (block.startMinute != null) {
      const start = DateTime.fromISO(block.date, { zone: tz }).startOf("day").set({ hour: Math.floor(block.startMinute / 60), minute: block.startMinute % 60 });
      body.start = { dateTime: start.toISO()!, timeZone: tz };
      body.end = { dateTime: start.plus({ hours }).toISO()!, timeZone: tz };
    } else {
      body.start = { date: block.date };
      body.end = { date: DateTime.fromISO(block.date).plus({ days: 1 }).toISODate()! };
    }
    seen.add(String(block.id));
    const prev = byBlockId.get(String(block.id));
    if (prev?.id) {
      const same = prev.summary === body.summary && JSON.stringify(prev.start) === JSON.stringify({ ...prev.start, ...body.start }) && prev.start?.date === body.start.date && prev.start?.dateTime === body.start.dateTime;
      if (!same) {
        await api.events.patch({ calendarId: calId, eventId: prev.id, requestBody: body });
        updated++;
      }
      if (block.googleEventId !== prev.id) await db.update(workBlocks).set({ googleEventId: prev.id, googleCalendarId: calId }).where(eq(workBlocks.id, block.id));
    } else {
      const res = await api.events.insert({ calendarId: calId, requestBody: body });
      await db.update(workBlocks).set({ googleEventId: res.data.id ?? null, googleCalendarId: calId }).where(eq(workBlocks.id, block.id));
      created++;
    }
  }
  for (const [bid, ev] of byBlockId) {
    if (!seen.has(bid) && ev.id) {
      await api.events.delete({ calendarId: calId, eventId: ev.id });
      deleted++;
    }
  }
  return { created, updated, deleted, calendarId: calId };
}
