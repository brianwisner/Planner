"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DateTime } from "luxon";
import { api } from "@/lib/client/api";
import { fmtMinutes } from "@/lib/format";
import { LogTimeDialog } from "./LogTimeDialog";
import { Dialog } from "@/components/ui/Dialog";
import { notifyTimerChanged, useRunningTimer } from "./TimerBar";
import { Notice } from "@/components/ui/Notice";

type Entry = { id: number; userId: number; userName: string; projectId: number; projectName: string; clientName: string; taskName: string | null; entryDate: string; startedAt: string | null; endedAt: string | null; durationMinutes: number; notes: string | null; billable: boolean; source: string; version: number };

export function TimeSheet({ tz, isOwner, initialWeek, projectId }: { tz: string; isOwner: boolean; initialWeek?: string; projectId?: number }) {
  const [weekStart, setWeekStart] = useState(() => (initialWeek ? DateTime.fromISO(initialWeek) : DateTime.now().setZone(tz)).startOf("week"));
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [error, setError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [edit, setEdit] = useState({ entryDate: "", hours: "", notes: "", billable: true });
  const { timer } = useRunningTimer();
  const from = weekStart.toISODate()!;
  const to = weekStart.plus({ days: 6 }).toISODate()!;

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api<{ entries: Entry[] }>(`/api/time?from=${from}&to=${to}&scope=${scope}${projectId ? `&projectId=${projectId}` : ""}`);
      setEntries(r.entries);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [from, to, scope, projectId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener("timer-changed", h);
    return () => window.removeEventListener("timer-changed", h);
  }, [load]);

  const days = Array.from({ length: 7 }, (_, i) => weekStart.plus({ days: i }).toISODate()!);
  const done = (e: Entry) => !!e.endedAt || e.source === "manual";
  const byDay = (d: string) => (entries ?? []).filter((e) => e.entryDate === d);
  const total = (list: Entry[]) => list.filter(done).reduce((s, e) => s + e.durationMinutes, 0);
  const weekTotal = total(entries ?? []);
  const billableTotal = total((entries ?? []).filter((e) => e.billable));

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    try {
      await api(`/api/time/${editing.id}`, { method: "PATCH", json: { entryDate: edit.entryDate, durationMinutes: Math.round(Number(edit.hours) * 60), notes: edit.notes || null, billable: edit.billable, version: editing.version } });
      setEditing(null);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function remove(e: Entry) {
    if (!confirm("Delete this time entry?")) return;
    try {
      await api(`/api/time/${e.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function restart(e: Entry) {
    try {
      await api("/api/timers/start", { method: "POST", json: { projectId: e.projectId } });
      notifyTimerChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-sm" onClick={() => setWeekStart(weekStart.minus({ weeks: 1 }))}>‹ Prev</button>
        <button className="btn btn-sm" onClick={() => setWeekStart(DateTime.now().setZone(tz).startOf("week"))}>This week</button>
        <button className="btn btn-sm" onClick={() => setWeekStart(weekStart.plus({ weeks: 1 }))}>Next ›</button>
        <span className="text-sm font-medium ml-1">{weekStart.toFormat("LLL d")} – {weekStart.plus({ days: 6 }).toFormat("LLL d, yyyy")}</span>
        {isOwner && (
          <select className="select w-auto ml-auto min-h-[36px] py-1" value={scope} onChange={(e) => setScope(e.target.value as "mine" | "all")}>
            <option value="mine">My time</option><option value="all">Everyone</option>
          </select>
        )}
        <button className="btn btn-primary btn-sm" onClick={() => setLogOpen(true)}>Log time</button>
      </div>
      {error && <Notice kind="danger">{error}</Notice>}
      {timer && <Notice kind="ok">Timer running on <strong>{timer.projectName}</strong> since {DateTime.fromISO(timer.startedAt).setZone(tz).toFormat("h:mm a")}. It will appear below once stopped.</Notice>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card"><div className="label">Week total</div><div className="text-2xl font-semibold">{fmtMinutes(weekTotal)}</div></div>
        <div className="card"><div className="label">Billable</div><div className="text-2xl font-semibold">{fmtMinutes(billableTotal)}</div></div>
        <div className="card"><div className="label">Entries</div><div className="text-2xl font-semibold">{entries?.length ?? "–"}</div></div>
        <div className="card"><div className="label">Avg / working day</div><div className="text-2xl font-semibold">{fmtMinutes(Math.round(weekTotal / Math.max(1, days.filter((d) => byDay(d).length).length)))}</div></div>
      </div>
      {entries === null ? <div className="card text-sm muted">Loading…</div> : entries.length === 0 ? (
        <div className="card text-center py-8"><div className="font-medium">No time this week.</div><div className="text-sm muted">Use the timer from Today or a project, or log time manually.</div></div>
      ) : (
        <div className="space-y-3">
          {days.map((d) => {
            const list = byDay(d);
            if (list.length === 0) return null;
            return (
              <div key={d} className="card p-0">
                <div className="flex justify-between px-4 py-2 border-b border-line bg-surface-2 rounded-t-xl text-sm"><span className="font-medium">{DateTime.fromISO(d).toFormat("EEEE, LLL d")}</span><span>{fmtMinutes(total(list))}</span></div>
                <ul className="divide-y divide-line">
                  {list.map((e) => (
                    <li key={e.id} className="px-4 py-2 flex flex-wrap items-center gap-2 text-sm">
                      <div className="flex-1 min-w-[160px]">
                        <Link href={`/projects/${e.projectId}`} className="link font-medium">{e.projectName}</Link>
                        <span className="muted"> · {e.clientName}{e.taskName ? ` · ${e.taskName}` : ""}{scope === "all" ? ` · ${e.userName}` : ""}</span>
                        {e.notes && <div className="text-xs muted">{e.notes}</div>}
                      </div>
                      <span className="w-20 text-right font-mono">{done(e) ? fmtMinutes(e.durationMinutes) : "running"}</span>
                      {!e.billable && <span className="badge bg-surface-2 text-muted">non-billable</span>}
                      {done(e) && <button className="btn btn-sm" onClick={() => { setEditing(e); setEdit({ entryDate: e.entryDate, hours: String(Math.round((e.durationMinutes / 60) * 100) / 100), notes: e.notes ?? "", billable: e.billable }); }}>Edit</button>}
                      {done(e) && !timer && <button className="btn btn-sm" title="Start a new timer on this project" onClick={() => restart(e)}>▶</button>}
                      <button className="link text-xs" onClick={() => remove(e)}>Delete</button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      <LogTimeDialog open={logOpen} onClose={() => setLogOpen(false)} onSaved={load} projectId={projectId} />
      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Edit time entry">
        <form onSubmit={saveEdit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="label">Date</span><input className="input" type="date" value={edit.entryDate} onChange={(e) => setEdit({ ...edit, entryDate: e.target.value })} /></label>
            <label className="block"><span className="label">Hours</span><input className="input" type="number" step="0.25" min="0.25" value={edit.hours} onChange={(e) => setEdit({ ...edit, hours: e.target.value })} /></label>
          </div>
          <label className="block"><span className="label">Notes</span><input className="input" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.billable} onChange={(e) => setEdit({ ...edit, billable: e.target.checked })} /> Billable</label>
          <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary">Save</button></div>
        </form>
      </Dialog>
    </div>
  );
}
