"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Section } from "@/components/ui/Form";
import { Dialog } from "@/components/ui/Dialog";
import { fmtDateTime } from "@/lib/format";

type Item = { id: number; kind: string; subject: string | null; body: string | null; occurredAt: Date | string; linkUrl: string | null; createdByName?: string | null; projectName?: string | null; projectId?: number | null };

export function CorrespondenceList({ items, clientId, projectId, projects }: { items: Item[]; clientId?: number; projectId?: number; projects?: { id: number; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ kind: "note", subject: "", body: "", projectId: projectId ? String(projectId) : "", linkUrl: "" });
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api("/api/correspondence", { method: "POST", json: { clientId: clientId ?? null, projectId: form.projectId ? Number(form.projectId) : null, kind: form.kind, subject: form.subject || null, body: form.body || null, linkUrl: form.linkUrl || null } });
      setOpen(false);
      setForm({ kind: "note", subject: "", body: "", projectId: projectId ? String(projectId) : "", linkUrl: "" });
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function remove(id: number) {
    if (!confirm("Delete this entry?")) return;
    await api(`/api/correspondence/${id}`, { method: "DELETE" });
    router.refresh();
  }
  const icon: Record<string, string> = { note: "✎", email: "✉", call: "☎", meeting: "☺" };
  return (
    <Section title="Notes & correspondence" actions={<button className="btn btn-sm" onClick={() => setOpen(true)}>Add note</button>}>
      {items.length === 0 ? <p className="text-sm muted">Nothing recorded yet. Add notes from calls and meetings, or link emails from the Inbox.</p> : (
        <ul className="divide-y divide-line">
          {items.map((it) => (
            <li key={it.id} className="py-2 text-sm">
              <div className="flex items-start gap-2">
                <span className="opacity-60 w-4" aria-hidden>{icon[it.kind] ?? "•"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="font-medium">{it.subject || it.kind}</span>
                    <span className="text-xs muted">{fmtDateTime(it.occurredAt as string)}{it.createdByName ? ` · ${it.createdByName}` : ""}{it.projectName ? ` · ${it.projectName}` : ""}</span>
                  </div>
                  {it.body && <div className="whitespace-pre-wrap text-sm mt-0.5 break-words">{it.body}</div>}
                  {it.linkUrl && <a className="link text-xs" href={it.linkUrl} target="_blank" rel="noreferrer">Open original ↗</a>}
                </div>
                <button className="link text-xs" onClick={() => remove(it.id)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Add note">
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="note">Note</option><option value="call">Call</option><option value="meeting">Meeting</option><option value="email">Email</option>
            </select>
            {projects && !projectId && (
              <select className="select" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
                <option value="">Client only</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
          </div>
          <input className="input" placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          <textarea className="textarea" placeholder="What was discussed or decided?" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <input className="input" placeholder="Link (optional)" value={form.linkUrl} onChange={(e) => setForm({ ...form, linkUrl: e.target.value })} />
          {err && <div className="text-sm text-danger">{err}</div>}
          <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary">Save</button></div>
        </form>
      </Dialog>
    </Section>
  );
}
