"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { useSave } from "@/lib/client/useSave";
import { SaveIndicator } from "@/components/ui/SaveState";
import { Field, Row } from "@/components/ui/Form";
import { Notice } from "@/components/ui/Notice";
import { STATUS_LABELS } from "@/lib/format";

type Client = { id: number; name: string };
type PType = { id: number; name: string; defaultScope: string | null; defaultHours: string | null; defaultFee: string | null; defaultFeeType: string; defaultTasks: { name: string; hours: number }[]; active: boolean };

export type ProjectInput = {
  clientId: number | null;
  name: string;
  address: string | null;
  projectTypeId: number | null;
  scope: string | null;
  complexity: "low" | "medium" | "high";
  status: string;
  priority: number;
  tentativeReserve: boolean;
  inquiryDate: string | null;
  acceptanceDate: string | null;
  plannedStart: string | null;
  actualStart: string | null;
  targetCompletion: string | null;
  clientDueDate: string | null;
  actualCompletion: string | null;
  estimatedHours: string | null;
  remainingHours: string | null;
  feeType: "hourly" | "fixed" | null;
  feeAmount: string | null;
  hourlyRate: string | null;
  notes: string | null;
  links: { label: string; url: string }[];
};

const empty: ProjectInput = { clientId: null, name: "", address: null, projectTypeId: null, scope: null, complexity: "medium", status: "inquiry", priority: 3, tentativeReserve: false, inquiryDate: null, acceptanceDate: null, plannedStart: null, actualStart: null, targetCompletion: null, clientDueDate: null, actualCompletion: null, estimatedHours: null, remainingHours: null, feeType: null, feeAmount: null, hourlyRate: null, notes: null, links: [] };

function DateField({ k, label, hint, v, set }: { k: keyof ProjectInput; label: string; hint?: string; v: ProjectInput; set: (k: keyof ProjectInput, val: unknown) => void }) {
  return (
    <Field label={label} hint={hint}><input className="input" type="date" value={(v[k] as string | null) ?? ""} onChange={(e) => set(k, e.target.value)} /></Field>
  );
}

export function ProjectForm({ initial, id, version, onSaved }: { initial?: Partial<ProjectInput>; id?: number; version?: number; onSaved?: () => void }) {
  const router = useRouter();
  const [v, setV] = useState<ProjectInput>({ ...empty, ...initial });
  const [clients, setClients] = useState<Client[]>([]);
  const [types, setTypes] = useState<PType[]>([]);
  const [applyTemplate, setApplyTemplate] = useState(true);
  const [ver, setVer] = useState(version ?? 1);
  const { status, message, conflict, run } = useSave();
  const set = (k: keyof ProjectInput, val: unknown) => setV((s) => ({ ...s, [k]: val === "" ? null : val }));

  useEffect(() => {
    api<{ clients: Client[] }>("/api/clients?status=active").then((r) => setClients(r.clients)).catch(() => {});
    api<{ projectTypes: PType[] }>("/api/project-types").then((r) => setTypes(r.projectTypes.filter((t) => t.active))).catch(() => {});
  }, []);
  const type = types.find((t) => t.id === v.projectTypeId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload = { ...v, clientId: v.clientId ?? undefined, estimatedHours: v.estimatedHours ?? null, remainingHours: v.remainingHours ?? null, feeAmount: v.feeAmount ?? null, hourlyRate: v.hourlyRate ?? null };
    if (id) {
      const r = await run(() => api<{ project: { version: number } }>(`/api/projects/${id}`, { method: "PATCH", json: { ...payload, version: ver } }));
      if (r) {
        setVer(r.project.version);
        onSaved?.();
        router.refresh();
      }
    } else {
      const r = await run(() => api<{ project: { id: number } }>("/api/projects", { method: "POST", json: { ...payload, applyTemplate } }));
      if (r) router.push(`/projects/${r.project.id}`);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Row>
        <Field label="Client *">
          <select className="select" required value={v.clientId ?? ""} onChange={(e) => set("clientId", e.target.value ? Number(e.target.value) : null)}>
            <option value="">Choose a client…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Project name *"><input className="input" required value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Smith residence addition" /></Field>
      </Row>
      <Field label="Project address"><input className="input" value={v.address ?? ""} onChange={(e) => set("address", e.target.value)} /></Field>
      <Row cols={3}>
        <Field label="Project type" hint={!id && type ? `Template: ${type.defaultTasks.length} tasks, ${type.defaultHours ?? "–"} h` : undefined}>
          <select className="select" value={v.projectTypeId ?? ""} onChange={(e) => set("projectTypeId", e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Complexity">
          <select className="select" value={v.complexity} onChange={(e) => set("complexity", e.target.value)}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select>
        </Field>
        <Field label="Priority">
          <select className="select" value={v.priority} onChange={(e) => set("priority", Number(e.target.value))}>
            <option value={1}>Urgent</option><option value={2}>High</option><option value={3}>Normal</option><option value={4}>Low</option>
          </select>
        </Field>
      </Row>
      {!id && type && (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={applyTemplate} onChange={(e) => setApplyTemplate(e.target.checked)} /> Apply the template (scope text, task list, default hours and fee)</label>
      )}
      <Field label="Scope"><textarea className="textarea" value={v.scope ?? ""} onChange={(e) => set("scope", e.target.value)} placeholder={type?.defaultScope ?? "What is included?"} /></Field>
      <Row cols={3}>
        <Field label="Status">
          <select className="select" value={v.status} onChange={(e) => set("status", e.target.value)}>
            {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <label className="flex items-end gap-2 text-sm pb-2 sm:col-span-2">
          <input type="checkbox" checked={v.tentativeReserve} onChange={(e) => set("tentativeReserve", e.target.checked)} />
          <span>Reserve tentative capacity for this opportunity before it is accepted</span>
        </label>
      </Row>
      <Row cols={4}>
        <DateField k="inquiryDate" label="Inquiry date" v={v} set={set} />
        <DateField k="acceptanceDate" label="Accepted on" hint="When the client said yes" v={v} set={set} />
        <DateField k="plannedStart" label="Planned start" v={v} set={set} />
        <DateField k="actualStart" label="Actual start" hint="When work really began" v={v} set={set} />
      </Row>
      <Row cols={3}>
        <DateField k="clientDueDate" label="Client due date" hint="Commitment made to the client" v={v} set={set} />
        <DateField k="targetCompletion" label="Internal target" hint="Your own goal; forecasts are computed from the schedule" v={v} set={set} />
        <DateField k="actualCompletion" label="Actual completion" v={v} set={set} />
      </Row>
      <Row cols={4}>
        <Field label="Estimated hours"><input className="input" type="number" step="0.25" min="0" value={v.estimatedHours ?? ""} onChange={(e) => set("estimatedHours", e.target.value)} /></Field>
        <Field label="Remaining hours" hint="Leave blank to derive from estimate − actual"><input className="input" type="number" step="0.25" min="0" value={v.remainingHours ?? ""} onChange={(e) => set("remainingHours", e.target.value)} /></Field>
        <Field label="Fee basis">
          <select className="select" value={v.feeType ?? ""} onChange={(e) => set("feeType", e.target.value || null)}>
            <option value="">—</option><option value="fixed">Fixed fee</option><option value="hourly">Hourly</option>
          </select>
        </Field>
        <Field label={v.feeType === "hourly" ? "Hourly rate ($)" : "Fee ($)"}><input className="input" type="number" step="1" min="0" value={(v.feeType === "hourly" ? v.hourlyRate : v.feeAmount) ?? ""} onChange={(e) => set(v.feeType === "hourly" ? "hourlyRate" : "feeAmount", e.target.value)} /></Field>
      </Row>
      <Field label="Notes"><textarea className="textarea" value={v.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></Field>
      <Field label="Links" hint="One per line: label | https://…">
        <textarea className="textarea min-h-[60px]" value={v.links.map((l) => `${l.label} | ${l.url}`).join("\n")} onChange={(e) => set("links", e.target.value.split("\n").filter(Boolean).map((line) => { const [label, url] = line.split("|").map((s) => s.trim()); return { label: label ?? "", url: url ?? label ?? "" }; }))} />
      </Field>
      {conflict ? <Notice kind="warn">{message} <button type="button" className="link ml-2" onClick={() => router.refresh()}>Reload latest</button></Notice> : null}
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" disabled={status === "saving"} type="submit">{id ? "Save changes" : "Create project"}</button>
        <SaveIndicator status={status} message={message} />
      </div>
    </form>
  );
}
