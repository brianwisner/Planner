"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Section } from "@/components/ui/Form";
import { Notice } from "@/components/ui/Notice";
import { Pill } from "@/components/ui/Badges";
import { fmtDateTime } from "@/lib/format";

type Account = { email: string | null; status: string; lastError: string | null; gmailLastScanAt: string | null; gmailLastError: string | null; writebackCalendarId: string | null; calendar: boolean; calendarWrite: boolean; gmail: boolean };
type Cal = { id: number; googleCalendarId: string; summary: string; isPrimary: boolean; accessRole: string | null; affectsAvailability: boolean; lastSyncedAt: string | null; lastError: string | null };

export function GoogleSettings({ account, calendars, isOwner }: { account: Account | null; calendars: Cal[]; isOwner: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "danger" | "info"; text: string } | null>(null);
  async function act(label: string, fn: () => Promise<string | void>) {
    setBusy(label);
    setMsg(null);
    try { const t = await fn(); if (t) setMsg({ kind: "ok", text: t }); router.refresh(); } catch (e) { setMsg({ kind: "danger", text: (e as Error).message }); } finally { setBusy(null); }
  }
  const connected = account && account.status !== "disconnected";
  const writable = calendars.filter((c) => ["owner", "writer"].includes(c.accessRole ?? ""));
  return (
    <div className="space-y-4">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <Section title="Connection">
        {!connected ? (
          <div className="text-sm space-y-2">
            <p>Not connected. Choose what to connect; you can add the other later.</p>
            <div className="flex flex-wrap gap-2">
              <a className="btn btn-primary" href="/api/google/connect?feature=calendar">Connect Google Calendar (read-only)</a>
              <a className="btn" href="/api/google/connect?feature=gmail">Connect Gmail (read-only)</a>
            </div>
          </div>
        ) : (
          <div className="text-sm space-y-2">
            <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{account!.email}</span><Pill tone={account!.status === "connected" ? "ok" : "danger"}>{account!.status}</Pill></div>
            {account!.lastError && <Notice kind="danger">{account!.lastError}</Notice>}
            <div className="flex flex-wrap gap-2 items-center">
              <Pill tone={account!.calendar ? "ok" : "muted"}>Calendar read {account!.calendar ? "✓" : "–"}</Pill>
              <Pill tone={account!.calendarWrite ? "ok" : "muted"}>Calendar write {account!.calendarWrite ? "✓" : "–"}</Pill>
              <Pill tone={account!.gmail ? "ok" : "muted"}>Gmail read {account!.gmail ? "✓" : "–"}</Pill>
            </div>
            <div className="flex flex-wrap gap-2">
              {!account!.calendar && <a className="btn btn-sm" href="/api/google/connect?feature=calendar">Add Calendar access</a>}
              {!account!.gmail && <a className="btn btn-sm" href="/api/google/connect?feature=gmail">Add Gmail access</a>}
              {!account!.calendarWrite && <a className="btn btn-sm" href="/api/google/connect?feature=writeback">Add Calendar write access (for write-back)</a>}
              <button className="btn btn-sm btn-danger" disabled={!!busy} onClick={() => confirm("Disconnect Google? Synced calendar events and inbox suggestions are removed; your clients, projects and notes are kept.") && act("disc", async () => { await api("/api/google/disconnect", { method: "POST" }); return "Disconnected."; })}>Disconnect</button>
            </div>
          </div>
        )}
      </Section>

      {connected && account!.calendar && (
        <Section title="Calendars that affect availability" actions={<div className="flex gap-2"><button className="btn btn-sm" disabled={!!busy} onClick={() => act("refresh", async () => { const r = await api<{ count: number }>("/api/google/calendars/refresh", { method: "POST" }); return `${r.count} calendars found.`; })}>Refresh list</button><button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => act("sync", async () => { const r = await api<{ results: { calendar: string; upserts?: number; removed?: number; error?: string }[] }>("/api/google/calendars/sync", { method: "POST" }); return r.results.map((x) => `${x.calendar}: ${x.error ? "error — " + x.error : `${x.upserts} updated, ${x.removed} removed`}`).join("; ") || "No calendars selected."; })}>{busy === "sync" ? "Syncing…" : "Sync now"}</button></div>}>
          {calendars.length === 0 ? <p className="text-sm muted">Click “Refresh list” to load your calendars.</p> : (
            <ul className="divide-y divide-line text-sm">
              {calendars.map((c) => (
                <li key={c.id} className="py-2 flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 flex-1"><input type="checkbox" checked={c.affectsAvailability} onChange={(e) => act("toggle", async () => { await api(`/api/google/calendars/${c.id}`, { method: "PATCH", json: { affectsAvailability: e.target.checked } }); })} /> {c.summary}{c.isPrimary && <Pill tone="accent">primary</Pill>}</label>
                  <span className="text-xs muted">{c.lastError ? <span className="text-danger">{c.lastError}</span> : c.lastSyncedAt ? `synced ${fmtDateTime(c.lastSyncedAt)}` : c.affectsAvailability ? "not synced yet" : ""}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs muted mt-2">Busy events in selected calendars reduce available hours. Events marked “Free” in Google are ignored; a busy all-day event blocks the whole day. Recurring events and cancellations are handled by Google’s expanded, incremental sync. Sync runs when you open the app (at most every 15 minutes) and when you click Sync now.</p>
        </Section>
      )}

      {connected && account!.calendar && isOwner && (
        <Section title="Write-back (optional)">
          <p className="text-sm muted mb-2">When enabled, “Publish to Google Calendar” on the Schedule page copies approved work blocks to the chosen calendar as <em>Free</em> events tagged by this app. Published events are ignored when computing availability, so they are never double-counted. Deleting a block in Workbench removes its event on the next publish; edits made in Google Calendar to these events are overwritten on the next publish.</p>
          {!account!.calendarWrite ? <a className="btn btn-sm" href="/api/google/connect?feature=writeback">Grant calendar write access</a> : (
            <select className="select max-w-sm" value={account!.writebackCalendarId ?? ""} onChange={(e) => act("wb", async () => { await api("/api/google/writeback", { method: "PUT", json: { calendarId: e.target.value || null } }); return e.target.value ? "Write-back enabled." : "Write-back disabled."; })}>
              <option value="">Disabled</option>
              {writable.map((c) => <option key={c.id} value={c.googleCalendarId}>{c.summary}</option>)}
            </select>
          )}
        </Section>
      )}

      {connected && (
        <Section title="Gmail">
          {!account!.gmail ? <a className="btn btn-sm" href="/api/google/connect?feature=gmail">Connect Gmail (read-only)</a> : (
            <div className="text-sm space-y-1">
              <div>Read-only access is connected. {account!.gmailLastScanAt ? `Last scan ${fmtDateTime(account!.gmailLastScanAt)}.` : "Not scanned yet."}</div>
              {account!.gmailLastError && <Notice kind="danger">{account!.gmailLastError}</Notice>}
              <p className="muted">The app reads recent inbox metadata to suggest client and project links. It never sends, deletes, archives, or relabels mail. Open the Inbox page to scan.</p>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
