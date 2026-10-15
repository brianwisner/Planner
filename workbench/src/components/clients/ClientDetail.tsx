"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ClientFull } from "@/lib/services/clients";
import { ClientForm } from "./ClientForm";
import { Dialog } from "@/components/ui/Dialog";
import { Section } from "@/components/ui/Form";
import { StatusBadge, PriorityBadge } from "@/components/ui/Badges";
import { api } from "@/lib/client/api";
import { fmtDate, fmtDateTime, fmtHours, fmtMoney } from "@/lib/format";
import { CorrespondenceList } from "@/components/shared/Correspondence";
import { HistoryList } from "@/components/shared/History";

export function ClientDetail({ client }: { client: ClientFull }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [contact, setContact] = useState({ name: "", role: "", email: "", phone: "" });
  const [err, setErr] = useState<string | null>(null);

  async function addContact(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api(`/api/clients/${client.id}/contacts`, { method: "POST", json: { ...contact, isPrimary: client.contacts.length === 0 } });
      setContactOpen(false);
      setContact({ name: "", role: "", email: "", phone: "" });
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function removeContact(id: number) {
    if (!confirm("Remove this contact?")) return;
    await api(`/api/contacts/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <Section title="Details" actions={<button className="btn btn-sm" onClick={() => setEditing(true)}>Edit</button>}>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div><dt className="label">Company</dt><dd>{client.company ?? "–"}</dd></div>
            <div><dt className="label">Type</dt><dd className="capitalize">{client.kind}</dd></div>
            <div><dt className="label">Email</dt><dd>{client.email ? <a className="link" href={`mailto:${client.email}`}>{client.email}</a> : "–"}</dd></div>
            <div><dt className="label">Phone</dt><dd>{client.phone ? <a className="link" href={`tel:${client.phone}`}>{client.phone}</a> : "–"}</dd></div>
            <div className="sm:col-span-2"><dt className="label">Address</dt><dd>{client.address ?? "–"}</dd></div>
            {client.notes && <div className="sm:col-span-2"><dt className="label">Notes</dt><dd className="whitespace-pre-wrap">{client.notes}</dd></div>}
          </dl>
        </Section>

        <Section title="Projects" actions={<Link href={`/projects/new?clientId=${client.id}`} className="btn btn-sm btn-primary">New project</Link>}>
          {client.projects.length === 0 ? (
            <p className="text-sm muted">No projects yet. Create one to start estimating and scheduling.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Project</th><th>Status</th><th className="hidden sm:table-cell">Priority</th><th className="hidden md:table-cell">Due</th><th className="hidden md:table-cell">Est.</th><th className="hidden md:table-cell">Fee</th></tr></thead>
                <tbody>
                  {client.projects.map((p) => (
                    <tr key={p.id}>
                      <td><Link href={`/projects/${p.id}`} className="link font-medium">{p.name}</Link><div className="text-xs muted">{p.address}</div></td>
                      <td><StatusBadge status={p.status} /></td>
                      <td className="hidden sm:table-cell"><PriorityBadge priority={p.priority} /></td>
                      <td className="hidden md:table-cell">{fmtDate(p.clientDueDate ?? p.targetCompletion)}</td>
                      <td className="hidden md:table-cell">{fmtHours(p.estimatedHours)}</td>
                      <td className="hidden md:table-cell">{fmtMoney(p.feeAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <CorrespondenceList items={client.correspondence} clientId={client.id} projects={client.projects.map((p) => ({ id: p.id, name: p.name }))} />
      </div>

      <div className="space-y-4">
        <Section title="Contacts" actions={<button className="btn btn-sm" onClick={() => setContactOpen(true)}>Add</button>}>
          {client.contacts.length === 0 ? <p className="text-sm muted">No contacts recorded.</p> : (
            <ul className="space-y-2 text-sm">
              {client.contacts.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{c.name} {c.isPrimary && <span className="badge bg-accent-soft text-accent ml-1">primary</span>}</div>
                    <div className="muted text-xs">{[c.role, c.email, c.phone].filter(Boolean).join(" · ")}</div>
                  </div>
                  <button className="link text-xs" onClick={() => removeContact(c.id)}>Remove</button>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <HistoryList items={client.history} />
        <div className="text-xs muted">Created {fmtDateTime(client.createdAt)} · Updated {fmtDateTime(client.updatedAt)}</div>
      </div>

      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit client" wide>
        <ClientForm id={client.id} version={client.version} initial={{ name: client.name, company: client.company, email: client.email, phone: client.phone, address: client.address, kind: client.kind, notes: client.notes, status: client.status }} />
      </Dialog>
      <Dialog open={contactOpen} onClose={() => setContactOpen(false)} title="Add contact">
        <form onSubmit={addContact} className="space-y-3">
          <input className="input" placeholder="Name *" required value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
          <input className="input" placeholder="Role (e.g. project manager)" value={contact.role} onChange={(e) => setContact({ ...contact, role: e.target.value })} />
          <input className="input" type="email" placeholder="Email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
          <input className="input" type="tel" placeholder="Phone" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
          {err && <div className="text-sm text-danger">{err}</div>}
          <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={() => setContactOpen(false)}>Cancel</button><button className="btn btn-primary">Add contact</button></div>
        </form>
      </Dialog>
    </div>
  );
}
