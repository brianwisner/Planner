"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { useSave } from "@/lib/client/useSave";
import { SaveIndicator } from "@/components/ui/SaveState";
import { Field, Row } from "@/components/ui/Form";
import { Notice } from "@/components/ui/Notice";

export type ClientInput = {
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  kind: "homeowner" | "contractor" | "architect" | "developer" | "agency" | "other";
  notes: string | null;
  status: "active" | "archived";
};

export function ClientForm({ initial, id, version, prefill }: { initial?: Partial<ClientInput>; id?: number; version?: number; prefill?: { contactName?: string; email?: string } }) {
  const router = useRouter();
  const [v, setV] = useState<ClientInput>({ name: "", company: null, email: prefill?.email ?? null, phone: null, address: null, kind: "homeowner", notes: null, status: "active", ...initial });
  const [contactName, setContactName] = useState(prefill?.contactName ?? "");
  const [ver, setVer] = useState(version ?? 1);
  const { status, message, conflict, run } = useSave();
  const set = (k: keyof ClientInput, val: string) => setV((s) => ({ ...s, [k]: val === "" ? null : val }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (id) {
      const r = await run(() => api<{ client: { version: number } }>(`/api/clients/${id}`, { method: "PATCH", json: { ...v, version: ver } }));
      if (r) {
        setVer(r.client.version);
        router.refresh();
      }
    } else {
      const r = await run(() => api<{ client: { id: number } }>("/api/clients", { method: "POST", json: { ...v, primaryContact: contactName ? { name: contactName, email: v.email ?? undefined, phone: v.phone ?? undefined } : undefined } }));
      if (r) router.push(`/clients/${r.client.id}`);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Row>
        <Field label="Client name *"><input className="input" required value={v.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Company"><input className="input" value={v.company ?? ""} onChange={(e) => set("company", e.target.value)} /></Field>
      </Row>
      <Row cols={3}>
        <Field label="Email"><input className="input" type="email" value={v.email ?? ""} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="Phone"><input className="input" type="tel" value={v.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="Type">
          <select className="select" value={v.kind} onChange={(e) => set("kind", e.target.value)}>
            {["homeowner", "contractor", "architect", "developer", "agency", "other"].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
      </Row>
      {!id && (
        <Field label="Primary contact name (optional)" hint="If the client is a company, who do you talk to?"><input className="input" value={contactName} onChange={(e) => setContactName(e.target.value)} /></Field>
      )}
      <Field label="Mailing address"><input className="input" value={v.address ?? ""} onChange={(e) => set("address", e.target.value)} /></Field>
      <Field label="Notes"><textarea className="textarea" value={v.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></Field>
      {id && (
        <Field label="Status">
          <select className="select w-auto" value={v.status} onChange={(e) => set("status", e.target.value)}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </Field>
      )}
      {conflict ? <Notice kind="warn">{message} <button type="button" className="link ml-2" onClick={() => router.refresh()}>Reload latest</button></Notice> : null}
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" disabled={status === "saving"} type="submit">{id ? "Save changes" : "Create client"}</button>
        <SaveIndicator status={status} message={message} />
      </div>
    </form>
  );
}
