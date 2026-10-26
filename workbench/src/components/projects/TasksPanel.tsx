"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Section } from "@/components/ui/Form";
import { fmtDateShort, fmtHours } from "@/lib/format";

type Task = { id: number; name: string; phase: string | null; status: "todo" | "in_progress" | "done"; isMilestone: boolean; dueDate: string | null; estimatedHours: string | null; remainingHours: string | null; version: number };

export function TasksPanel({ projectId, tasks }: { projectId: number; tasks: Task[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [hours, setHours] = useState("");
  const [milestone, setMilestone] = useState(false);
  const [due, setDue] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [doneLocal, setDoneLocal] = useState<Record<number, boolean>>({}); // optimistic checkbox state until the server copy arrives
  const [edit, setEdit] = useState<{ name: string; estimatedHours: string; remainingHours: string; dueDate: string; phase: string }>({ name: "", estimatedHours: "", remainingHours: "", dueDate: "", phase: "" });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api(`/api/projects/${projectId}/tasks`, { method: "POST", json: { name, estimatedHours: hours ? Number(hours) : null, isMilestone: milestone, dueDate: due || null, sortOrder: tasks.length } });
      setName(""); setHours(""); setMilestone(false); setDue("");
      router.refresh();
    } catch (e) { setErr((e as Error).message); }
  }
  async function patch(t: Task, body: Record<string, unknown>) {
    setErr(null);
    try {
      await api(`/api/tasks/${t.id}`, { method: "PATCH", json: { ...body, version: t.version } });
      router.refresh();
    } catch (e) { setErr((e as Error).message); }
  }
  async function remove(t: Task) {
    if (!confirm(`Delete task "${t.name}"?`)) return;
    await api(`/api/tasks/${t.id}`, { method: "DELETE" });
    router.refresh();
  }
  const totalEst = tasks.reduce((s, t) => s + Number(t.estimatedHours ?? 0), 0);
  const totalRem = tasks.reduce((s, t) => s + Number(t.remainingHours ?? 0), 0);
  const phases = Array.from(new Set(tasks.map((t) => t.phase ?? "")));

  return (
    <Section title="Tasks & milestones" actions={<span className="text-xs muted">{fmtHours(totalRem)} remaining of {fmtHours(totalEst)}</span>}>
      {tasks.length === 0 && <p className="text-sm muted mb-2">No tasks yet. Project types add a task list automatically; you can also add tasks here.</p>}
      <ul className="divide-y divide-line">
        {phases.map((ph) => (
          <li key={ph || "none"} className="py-1">
            {ph && <div className="h3 mt-2 mb-1">{ph}</div>}
            {tasks.filter((t) => (t.phase ?? "") === ph).map((t) => (
              <div key={t.id} className="flex items-center gap-2 py-1.5 text-sm">
                <input type="checkbox" className="w-5 h-5" checked={doneLocal[t.id] ?? t.status === "done"} onChange={(e) => { setDoneLocal((d) => ({ ...d, [t.id]: e.target.checked })); patch(t, { status: e.target.checked ? "done" : "todo" }); }} aria-label={`Mark ${t.name} done`} />
                {editing === t.id ? (
                  <form className="flex-1 grid grid-cols-2 sm:grid-cols-5 gap-2" onSubmit={(e) => { e.preventDefault(); patch(t, { name: edit.name, estimatedHours: edit.estimatedHours ? Number(edit.estimatedHours) : null, remainingHours: edit.remainingHours ? Number(edit.remainingHours) : null, dueDate: edit.dueDate || null, phase: edit.phase || null }); setEditing(null); }}>
                    <input className="input col-span-2 sm:col-span-2" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                    <input className="input" placeholder="Est h" type="number" step="0.25" value={edit.estimatedHours} onChange={(e) => setEdit({ ...edit, estimatedHours: e.target.value })} />
                    <input className="input" placeholder="Rem h" type="number" step="0.25" value={edit.remainingHours} onChange={(e) => setEdit({ ...edit, remainingHours: e.target.value })} />
                    <input className="input" type="date" value={edit.dueDate} onChange={(e) => setEdit({ ...edit, dueDate: e.target.value })} />
                    <div className="col-span-2 sm:col-span-5 flex gap-2"><button className="btn btn-sm btn-primary">Save</button><button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button></div>
                  </form>
                ) : (
                  <>
                    <span className={`flex-1 ${(doneLocal[t.id] ?? t.status === "done") ? "line-through muted" : ""}`}>{t.isMilestone && <span title="Milestone">◆ </span>}{t.name}</span>
                    {t.dueDate && <span className="text-xs muted">{fmtDateShort(t.dueDate)}</span>}
                    <span className="text-xs muted w-24 text-right">{fmtHours(t.remainingHours)} / {fmtHours(t.estimatedHours)}</span>
                    <button className="link text-xs" onClick={() => { setEditing(t.id); setEdit({ name: t.name, estimatedHours: t.estimatedHours ?? "", remainingHours: t.remainingHours ?? "", dueDate: t.dueDate ?? "", phase: t.phase ?? "" }); }}>Edit</button>
                    <button className="link text-xs" onClick={() => remove(t)}>✕</button>
                  </>
                )}
              </div>
            ))}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="mt-3 flex flex-wrap gap-2 items-center">
        <input className="input flex-1 min-w-[160px]" placeholder="Add a task or milestone" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className="input w-24" placeholder="Hours" type="number" step="0.25" min="0" value={hours} onChange={(e) => setHours(e.target.value)} />
        <input className="input w-40" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
        <label className="text-sm flex items-center gap-1"><input type="checkbox" checked={milestone} onChange={(e) => setMilestone(e.target.checked)} /> Milestone</label>
        <button className="btn btn-sm">Add</button>
      </form>
      {err && <div className="text-sm text-danger mt-2">{err}</div>}
    </Section>
  );
}
