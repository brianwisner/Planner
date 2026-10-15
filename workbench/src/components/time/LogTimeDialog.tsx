"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Row } from "@/components/ui/Form";
import { todayISO } from "@/lib/format";

type Project = { id: number; name: string; clientName: string };

export function LogTimeDialog({ open, onClose, projectId, tasks, onSaved, projects }: { open: boolean; onClose: () => void; projectId?: number; tasks?: { id: number; name: string }[]; onSaved?: () => void; projects?: Project[] }) {
  const [pid, setPid] = useState<number | "">(projectId ?? "");
  const [list, setList] = useState<Project[]>(projects ?? []);
  const [taskId, setTaskId] = useState<number | "">("");
  const [date, setDate] = useState(todayISO());
  const [hours, setHours] = useState("1");
  const [notes, setNotes] = useState("");
  const [billable, setBillable] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open && !projectId && list.length === 0) api<{ projects: Project[] }>("/api/projects?status=accepted,in_progress,inquiry,proposed,on_hold").then((r) => setList(r.projects)).catch(() => {});
  }, [open, projectId, list.length]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const minutes = Math.round(Number(hours) * 60);
      await api("/api/time", { method: "POST", json: { projectId: Number(pid), taskId: taskId === "" ? null : Number(taskId), entryDate: date, durationMinutes: minutes, notes: notes || null, billable } });
      setNotes("");
      onSaved?.();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Log time">
      <form onSubmit={submit} className="space-y-3">
        {!projectId && (
          <Field label="Project">
            <select className="select" required value={pid} onChange={(e) => setPid(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Choose…</option>
              {list.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.clientName}</option>)}
            </select>
          </Field>
        )}
        {tasks && tasks.length > 0 && (
          <Field label="Task (optional)">
            <select className="select" value={taskId} onChange={(e) => setTaskId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">—</option>
              {tasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        )}
        <Row>
          <Field label="Date"><input className="input" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label="Hours"><input className="input" type="number" step="0.25" min="0.25" max="24" value={hours} onChange={(e) => setHours(e.target.value)} required inputMode="decimal" /></Field>
        </Row>
        <Field label="Notes"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did you work on?" /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} /> Billable</label>
        {err && <div className="text-sm text-danger">{err}</div>}
        <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save entry"}</button></div>
      </form>
    </Dialog>
  );
}
