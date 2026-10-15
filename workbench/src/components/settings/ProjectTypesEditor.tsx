"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Row } from "@/components/ui/Form";
import { fmtHours, fmtMoney } from "@/lib/format";

type T = { id: number; name: string; description: string | null; defaultScope: string | null; defaultTasks: { name: string; phase?: string; hours: number }[]; defaultFeeType: "hourly" | "fixed"; defaultFee: string | null; defaultHours: string | null; active: boolean; sortOrder: number };

export function ProjectTypesEditor({ types }: { types: T[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Partial<T> | null>(null);
  const [tasksText, setTasksText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  function open(t?: T) {
    setEditing(t ?? { name: "", defaultFeeType: "fixed", active: true, defaultTasks: [] });
    setTasksText((t?.defaultTasks ?? []).map((x) => `${x.phase ?? ""} | ${x.name} | ${x.hours}`).join("\n"));
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setErr(null);
    const defaultTasks = tasksText.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const parts = l.split("|").map((s) => s.trim()); if (parts.length >= 3) return { phase: parts[0] || undefined, name: parts[1], hours: Number(parts[2]) || 0 }; return { name: parts[0], hours: Number(parts[1]) || 0 }; });
    const body = { name: editing.name, description: editing.description ?? null, defaultScope: editing.defaultScope ?? null, defaultTasks, defaultFeeType: editing.defaultFeeType, defaultFee: editing.defaultFee ? Number(editing.defaultFee) : null, defaultHours: editing.defaultHours ? Number(editing.defaultHours) : defaultTasks.reduce((s, t) => s + t.hours, 0) || null, active: editing.active ?? true };
    try {
      if (editing.id) await api(`/api/project-types/${editing.id}`, { method: "PATCH", json: body });
      else await api("/api/project-types", { method: "POST", json: body });
      setEditing(null);
      router.refresh();
    } catch (e) { setErr((e as Error).message); }
  }
  return (
    <div>
      <div className="mb-3"><button className="btn btn-primary" onClick={() => open()}>Add project type</button></div>
      <div className="card p-0 overflow-x-auto">
        <table className="table">
          <thead><tr><th>Type</th><th>Tasks</th><th>Default hours</th><th>Fee</th><th>Active</th><th></th></tr></thead>
          <tbody>{types.map((t) => <tr key={t.id} className={!t.active ? "opacity-50" : ""}><td><div className="font-medium">{t.name}</div><div className="text-xs muted">{t.description}</div></td><td>{t.defaultTasks.length}</td><td>{fmtHours(t.defaultHours)}</td><td>{t.defaultFeeType === "fixed" ? fmtMoney(t.defaultFee) : "hourly"}</td><td>{t.active ? "yes" : "no"}</td><td><button className="link text-sm" onClick={() => open(t)}>Edit</button></td></tr>)}</tbody>
        </table>
      </div>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit project type" : "New project type"} wide>
        {editing && (
          <form onSubmit={save} className="space-y-3">
            <Row><Field label="Name *"><input className="input" required value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field><Field label="Description"><input className="input" value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field></Row>
            <Field label="Default scope text"><textarea className="textarea" value={editing.defaultScope ?? ""} onChange={(e) => setEditing({ ...editing, defaultScope: e.target.value })} /></Field>
            <Field label="Default tasks" hint="One per line: Phase | Task name | hours"><textarea className="textarea font-mono text-sm" value={tasksText} onChange={(e) => setTasksText(e.target.value)} placeholder="Design | Gravity design | 4" /></Field>
            <Row cols={4}>
              <Field label="Fee basis"><select className="select" value={editing.defaultFeeType} onChange={(e) => setEditing({ ...editing, defaultFeeType: e.target.value as "fixed" | "hourly" })}><option value="fixed">Fixed</option><option value="hourly">Hourly</option></select></Field>
              <Field label="Default fee ($)"><input className="input" type="number" value={editing.defaultFee ?? ""} onChange={(e) => setEditing({ ...editing, defaultFee: e.target.value })} /></Field>
              <Field label="Default hours" hint="Blank = sum of tasks"><input className="input" type="number" step="0.25" value={editing.defaultHours ?? ""} onChange={(e) => setEditing({ ...editing, defaultHours: e.target.value })} /></Field>
              <label className="flex items-end gap-2 pb-3 text-sm"><input type="checkbox" checked={editing.active ?? true} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Active</label>
            </Row>
            {err && <div className="text-sm text-danger">{err}</div>}
            <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary">Save</button></div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
