"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { api, ClientApiError } from "@/lib/client/api";
import { fmtHours, fmtDateShort } from "@/lib/format";
import { Dialog, ConfirmDialog } from "@/components/ui/Dialog";
import { Notice } from "@/components/ui/Notice";
import { Field, Row } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Badges";
import { StartTimerButton } from "@/components/today/TodayActions";

type Block = { id: number; projectId: number | null; projectName: string | null; taskId: number | null; date: string; hours: string; startMinute: number | null; kind: "work" | "commitment"; title: string | null; locked: boolean; source: string; sortOrder: number; note: string | null; version: number; clientDueDate: string | null };
type Day = { date: string; off: boolean; note?: string | null; availableHours: number; grossHours: number; eventHours: number; breakHours: number; bufferHours: number; allDayBusy: boolean; events: { summary: string; start: string; end: string; minutes: number; allDay: boolean }[]; blocks: Block[]; plannedHours: number; overbooked: boolean; overbookedBy: number };
type Project = { id: number; name: string; clientName: string; status: string; remaining: number; committed: boolean; tentativeReserve: boolean; clientDueDate: string | null };
type Data = { from: string; to: string; days: Day[]; projects: Project[]; prefs: { horizonDays: number } };
type Proposal = { id: number; title: string; status: string; createdAt: string; createdByName: string | null; summary: { moves: unknown[] } };

const minToTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const timeToMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };

export function ScheduleBoard({ me, scheduleUserId, users, initialFrom, highlightProject, writebackEnabled }: { me: { id: number; role: string; tz: string }; scheduleUserId: number; users: { id: number; name: string }[]; initialFrom?: string; highlightProject?: number; writebackEnabled: boolean }) {
  const router = useRouter();
  const isOwner = me.role === "owner";
  const [from, setFrom] = useState(() => (initialFrom ? DateTime.fromISO(initialFrom) : DateTime.now().setZone(me.tz)).startOf("week").toISODate()!);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [addFor, setAddFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<Block | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; retry: () => Promise<void> } | null>(null);
  const [includeTentative, setIncludeTentative] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const to = DateTime.fromISO(from).plus({ days: 13 }).toISODate()!;
  const today = DateTime.now().setZone(me.tz).toISODate()!;

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, p] = await Promise.all([api<Data>(`/api/schedule?userId=${scheduleUserId}&from=${from}&to=${to}`), api<{ proposals: Proposal[] }>("/api/proposals?status=proposed")]);
      setData(d);
      setProposals(p.proposals.filter((x) => x.status === "proposed"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [from, to, scheduleUserId]);
  useEffect(() => { load(); }, [load]);

  /** Runs a mutation; on a 409 overbooking response, asks the owner to confirm and retries with confirmOverbook. */
  async function mutate(label: string, fn: (confirmOverbook: boolean) => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn(false);
      await load();
    } catch (e) {
      const err = e as ClientApiError;
      if (err.status === 409 && err.body?.conflict) {
        setConfirm({ message: err.message, retry: async () => { setConfirm(null); setBusy(label); try { await fn(true); await load(); } catch (e2) { setError((e2 as Error).message); } finally { setBusy(null); } } });
      } else setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function recommend() {
    setBusy("recommend");
    setError(null);
    try {
      const r = await api<{ proposal: { id: number } }>("/api/proposals/generate", { method: "POST", json: { userId: scheduleUserId, includeTentative } });
      router.push(`/schedule/proposals/${r.proposal.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }
  async function publish() {
    await mutate("publish", async () => {
      const r = await api<{ created: number; updated: number; deleted: number }>("/api/google/publish", { method: "POST", json: {} });
      alert(`Published to Google Calendar: ${r.created} created, ${r.updated} updated, ${r.deleted} removed.`);
    });
  }
  function moveBlock(b: Block, date: string) {
    if (date === b.date) return;
    mutate("move", (c) => api(`/api/blocks/${b.id}`, { method: "PATCH", json: { date, version: b.version, confirmOverbook: c } }));
  }
  async function reorder(date: string, ids: number[]) {
    await mutate("reorder", () => api("/api/blocks/reorder", { method: "POST", json: { date, orderedIds: ids } }));
  }

  const weeks = data ? [data.days.slice(0, 7), data.days.slice(7, 14)] : [];
  const totalPlanned = data?.days.reduce((s, d) => s + d.plannedHours, 0) ?? 0;
  const totalAvail = data?.days.reduce((s, d) => s + d.availableHours, 0) ?? 0;
  const unscheduled = (data?.projects ?? []).filter((p) => p.committed && p.remaining > 0);

  return (
    <div>
      <PageHeader
        title="Schedule"
        subtitle={isOwner ? "Approved schedule. Changes here take effect immediately; recommendations are proposals until you accept them." : "Approved schedule (read-only). You can propose changes; Brian accepts or rejects them."}
        actions={
          <>
            <Link href="/schedule/proposals" className="btn">Proposals {proposals.length > 0 && <span className="badge bg-warn-soft text-warn">{proposals.length}</span>}</Link>
            <Link href="/schedule/whatif" className="btn">What-if</Link>
            <label className="flex items-center gap-1 text-sm px-2"><input type="checkbox" checked={includeTentative} onChange={(e) => setIncludeTentative(e.target.checked)} /> include tentative</label>
            <button className="btn btn-primary" onClick={recommend} disabled={busy === "recommend"}>{busy === "recommend" ? "Working…" : "Recommend schedule"}</button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button className="btn btn-sm" onClick={() => setFrom(DateTime.fromISO(from).minus({ weeks: 2 }).toISODate()!)}>‹ Earlier</button>
        <button className="btn btn-sm" onClick={() => setFrom(DateTime.now().setZone(me.tz).startOf("week").toISODate()!)}>This week</button>
        <button className="btn btn-sm" onClick={() => setFrom(DateTime.fromISO(from).plus({ weeks: 2 }).toISODate()!)}>Later ›</button>
        <span className="text-sm font-medium">{fmtDateShort(from)} – {fmtDateShort(to)}</span>
        {users.length > 1 && (
          <select className="select w-auto min-h-[36px] py-1 ml-auto" value={scheduleUserId} onChange={(e) => router.push(`/schedule?user=${e.target.value}&from=${from}`)}>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}&apos;s schedule</option>)}
          </select>
        )}
        {isOwner && writebackEnabled && <button className="btn btn-sm" onClick={publish} disabled={!!busy}>Publish to Google Calendar</button>}
        {data && <span className="text-sm muted">{fmtHours(totalPlanned)} planned of {fmtHours(totalAvail)} available</span>}
      </div>
      {error && <Notice kind="danger">{error}</Notice>}
      {proposals.length > 0 && <div className="mb-3"><Notice kind="warn">{proposals.length} schedule proposal{proposals.length > 1 ? "s" : ""} waiting for a decision. <Link className="underline" href={`/schedule/proposals/${proposals[0].id}`}>Review</Link></Notice></div>}
      {data && unscheduled.length > 0 && data.days.every((d) => d.blocks.length === 0) && (
        <div className="mb-3"><Notice kind="info">{unscheduled.length} committed project{unscheduled.length > 1 ? "s have" : " has"} remaining work but nothing scheduled in this range. Click <strong>Recommend schedule</strong> to get a proposal, or add work blocks to a day.</Notice></div>
      )}

      {!data ? <div className="card text-sm muted">Loading schedule…</div> : (
        <div className="space-y-3">
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-1 md:grid-cols-7 gap-2">
              {week.map((d) => (
                <DayCard
                  key={d.date}
                  day={d}
                  isToday={d.date === today}
                  isPast={d.date < today}
                  canEdit={isOwner}
                  highlightProject={highlightProject}
                  onAdd={() => setAddFor(d.date)}
                  onEdit={(b) => setEditing(b)}
                  dragId={dragId}
                  setDragId={setDragId}
                  onDropBlock={(blockId, targetDate, beforeId) => {
                    const b = data.days.flatMap((x) => x.blocks).find((x) => x.id === blockId);
                    if (!b) return;
                    if (b.date !== targetDate) moveBlock(b, targetDate);
                    else {
                      const ids = d.blocks.map((x) => x.id).filter((x) => x !== blockId);
                      const idx = beforeId ? ids.indexOf(beforeId) : ids.length;
                      ids.splice(idx < 0 ? ids.length : idx, 0, blockId);
                      reorder(targetDate, ids);
                    }
                  }}
                />
              ))}
            </div>
          ))}
          <div className="card">
            <div className="h3 mb-2">Committed projects with remaining work</div>
            {unscheduled.length === 0 ? <p className="text-sm muted">None.</p> : (
              <div className="flex flex-wrap gap-2 text-sm">
                {unscheduled.map((p) => {
                  const scheduledHere = data.days.flatMap((d) => d.blocks).filter((b) => b.projectId === p.id).reduce((s, b) => s + Number(b.hours), 0);
                  return <Link key={p.id} href={`/projects/${p.id}`} className={`badge border ${scheduledHere > 0 ? "bg-accent-soft text-accent border-accent/20" : "bg-surface-2 text-ink border-line"}`}>{p.name} · {fmtHours(p.remaining)} left{scheduledHere > 0 ? ` · ${fmtHours(scheduledHere)} here` : ""}{p.clientDueDate ? ` · due ${fmtDateShort(p.clientDueDate)}` : ""}</Link>;
                })}
              </div>
            )}
            <p className="text-xs muted mt-2">Work blocks are hours per day, in order. Drag to reorder or move (desktop), or use Edit to change the day on touch devices. 🔒 Locked blocks are never moved by recommendations.</p>
          </div>
        </div>
      )}

      {data && (
        <BlockDialog
          open={!!addFor || !!editing}
          onClose={() => { setAddFor(null); setEditing(null); }}
          date={editing?.date ?? addFor ?? today}
          block={editing}
          projects={data.projects}
          userId={scheduleUserId}
          onSave={async (body, c) => {
            if (editing) await mutate("save", (cc) => api(`/api/blocks/${editing.id}`, { method: "PATCH", json: { ...body, version: editing.version, confirmOverbook: cc || c } }));
            else await mutate("save", (cc) => api("/api/blocks", { method: "POST", json: { ...body, userId: scheduleUserId, confirmOverbook: cc || c } }));
            setAddFor(null);
            setEditing(null);
          }}
          onDelete={editing ? async () => { await mutate("delete", () => api(`/api/blocks/${editing.id}`, { method: "DELETE" })); setEditing(null); } : undefined}
        />
      )}
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} onConfirm={() => confirm?.retry()} title="This creates a conflict" message={confirm?.message} confirmLabel="Do it anyway" danger />
    </div>
  );
}

function DayCard({ day, isToday, isPast, canEdit, highlightProject, onAdd, onEdit, dragId, setDragId, onDropBlock }: { day: Day; isToday: boolean; isPast: boolean; canEdit: boolean; highlightProject?: number; onAdd: () => void; onEdit: (b: Block) => void; dragId: number | null; setDragId: (id: number | null) => void; onDropBlock: (blockId: number, date: string, beforeId?: number) => void }) {
  const [over, setOver] = useState(false);
  const pct = day.availableHours > 0 ? Math.min(100, (day.plannedHours / day.availableHours) * 100) : day.plannedHours > 0 ? 100 : 0;
  return (
    <div
      className={`card p-2 flex flex-col min-h-[120px] ${isToday ? "ring-2 ring-accent/40" : ""} ${day.off ? "bg-surface-2/60" : ""} ${over ? "ring-2 ring-info" : ""} ${isPast ? "opacity-70" : ""}`}
      onDragOver={(e) => { if (dragId != null && canEdit) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (dragId != null) onDropBlock(dragId, day.date); setDragId(null); }}
    >
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-medium">{DateTime.fromISO(day.date).toFormat("EEE d")}</div>
        <div className={`text-xs ${day.overbooked ? "text-danger font-medium" : "muted"}`}>{day.off ? (day.note ?? "off") : `${day.plannedHours}/${day.availableHours} h`}</div>
      </div>
      {!day.off && <div className="h-1.5 bg-surface-2 rounded my-1 overflow-hidden"><div className={`h-full ${day.overbooked ? "bg-danger" : "bg-accent"}`} style={{ width: `${pct}%` }} /></div>}
      {day.overbooked && <div className="text-[11px] text-danger">Overbooked by {day.overbookedBy} h</div>}
      {day.events.length > 0 && (
        <div className="text-[11px] muted mb-1 truncate" title={day.events.map((e) => e.summary).join(", ")}>
          {day.allDayBusy ? "All-day: " : "▣ "}{day.events.map((e) => e.summary).join(", ")}
        </div>
      )}
      <ul className="space-y-1 flex-1">
        {day.blocks.map((b) => (
          <li
            key={b.id}
            draggable={canEdit && !isPast}
            onDragStart={() => setDragId(b.id)}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => { if (dragId != null && dragId !== b.id) { e.preventDefault(); e.stopPropagation(); } }}
            onDrop={(e) => { if (dragId != null) { e.preventDefault(); e.stopPropagation(); onDropBlock(dragId, day.date, b.id); setDragId(null); } }}
            className={`rounded-md px-2 py-1 text-xs border ${b.kind === "commitment" ? "bg-warn-soft border-warn/20" : highlightProject === b.projectId ? "bg-info-soft border-info/30" : "bg-accent-soft border-accent/10"} ${canEdit ? "cursor-pointer" : ""}`}
            onClick={() => canEdit && onEdit(b)}
            role={canEdit ? "button" : undefined}
          >
            <div className="flex justify-between gap-1">
              <span className="truncate font-medium">{b.locked && "🔒 "}{b.title ?? b.projectName}</span>
              <span className="whitespace-nowrap">{Number(b.hours)} h</span>
            </div>
            {b.startMinute != null && <div className="muted">{minToTime(b.startMinute)}</div>}
            {isToday && b.projectId && <div className="mt-1" onClick={(e) => e.stopPropagation()}><StartTimerButton projectId={b.projectId} label="▶ Start timer" /></div>}
          </li>
        ))}
      </ul>
      {canEdit && <button className="text-xs link mt-1 text-left min-h-[32px]" onClick={onAdd}>+ Add work</button>}
    </div>
  );
}

function BlockDialog({ open, onClose, date, block, projects, onSave, onDelete }: { open: boolean; onClose: () => void; date: string; block: Block | null; projects: Project[]; userId: number; onSave: (body: Record<string, unknown>, confirm: boolean) => Promise<void>; onDelete?: () => Promise<void> }) {
  const [kind, setKind] = useState<"work" | "commitment">("work");
  const [projectId, setProjectId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [d, setD] = useState(date);
  const [hours, setHours] = useState("2");
  const [start, setStart] = useState("");
  const [locked, setLocked] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!open) return;
    setKind(block?.kind ?? "work");
    setProjectId(block?.projectId ? String(block.projectId) : "");
    setTitle(block?.title ?? "");
    setD(block?.date ?? date);
    setHours(block ? String(Number(block.hours)) : "2");
    setStart(block?.startMinute != null ? minToTime(block.startMinute) : "");
    setLocked(block?.locked ?? false);
    setNote(block?.note ?? "");
  }, [open, block, date]);
  const candidates = projects.filter((p) => p.committed || p.tentativeReserve || p.id === block?.projectId);
  return (
    <Dialog open={open} onClose={onClose} title={block ? "Edit work block" : "Add to schedule"}>
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); await onSave({ kind, projectId: kind === "work" ? Number(projectId) : null, title: kind === "commitment" ? title : null, date: d, hours: Number(hours), startMinute: start ? timeToMin(start) : null, locked: kind === "commitment" ? true : locked, note: note || null }, false); }}>
        <div className="flex gap-2">
          <button type="button" className={`btn btn-sm ${kind === "work" ? "bg-accent-soft text-accent" : ""}`} onClick={() => setKind("work")}>Project work</button>
          <button type="button" className={`btn btn-sm ${kind === "commitment" ? "bg-accent-soft text-accent" : ""}`} onClick={() => setKind("commitment")}>Fixed commitment</button>
        </div>
        {kind === "work" ? (
          <Field label="Project">
            <select className="select" required value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Choose…</option>
              {candidates.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmtHours(p.remaining)} left{!p.committed ? " (tentative)" : ""}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Title" hint="e.g. Site visit, jury duty. Fixed commitments are always locked."><input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        )}
        <Row cols={3}>
          <Field label="Date"><input className="input" type="date" value={d} onChange={(e) => setD(e.target.value)} required /></Field>
          <Field label="Hours"><input className="input" type="number" step="0.25" min="0.25" max="24" value={hours} onChange={(e) => setHours(e.target.value)} required inputMode="decimal" /></Field>
          <Field label="Start time (optional)"><input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        </Row>
        <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {kind === "work" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} /> Lock in place (recommendations will not move it)</label>}
        {block && (
          <div className="flex gap-2 text-sm">
            <span className="muted">Move:</span>
            <button type="button" className="link" onClick={() => setD(DateTime.fromISO(d).minus({ days: 1 }).toISODate()!)}>← previous day</button>
            <button type="button" className="link" onClick={() => setD(DateTime.fromISO(d).plus({ days: 1 }).toISODate()!)}>next day →</button>
          </div>
        )}
        <div className="flex justify-between gap-2 pt-1">
          {onDelete ? <button type="button" className="btn btn-danger" onClick={async () => { if (confirm("Remove this block from the schedule?")) await onDelete(); }}>Remove</button> : <span />}
          <div className="flex gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary">{block ? "Save" : "Add"}</button></div>
        </div>
        <p className="text-xs muted">If this overbooks the day, you will be asked to confirm. Other work is never moved automatically.</p>
      </form>
    </Dialog>
  );
}

export { Pill };
