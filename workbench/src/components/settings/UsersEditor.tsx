"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Section, Field, Row } from "@/components/ui/Form";
import { Notice } from "@/components/ui/Notice";

type U = { id: number; name: string; email: string; role: "owner" | "staff"; active: boolean };
export function UsersEditor({ users, me }: { users: U[]; me: { id: number; role: string } }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "Erika", email: "", password: "", role: "staff" as "staff" | "owner" });
  const [pw, setPw] = useState({ current: "", password: "", confirm: "" });
  const [msg, setMsg] = useState<{ kind: "ok" | "danger"; text: string } | null>(null);
  const isOwner = me.role === "owner";
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try { await api("/api/users", { method: "POST", json: form }); setForm({ name: "", email: "", password: "", role: "staff" }); setMsg({ kind: "ok", text: "User created. Share the temporary password with them; they can change it after signing in." }); router.refresh(); } catch (e) { setMsg({ kind: "danger", text: (e as Error).message }); }
  }
  async function patch(u: U, body: Record<string, unknown>) {
    setMsg(null);
    try { await api(`/api/users/${u.id}`, { method: "PATCH", json: body }); router.refresh(); setMsg({ kind: "ok", text: "Saved." }); } catch (e) { setMsg({ kind: "danger", text: (e as Error).message }); }
  }
  async function changePw(e: React.FormEvent) {
    e.preventDefault();
    if (pw.password !== pw.confirm) return setMsg({ kind: "danger", text: "New passwords do not match." });
    try { await api("/api/auth/password", { method: "POST", json: { current: pw.current, password: pw.password } }); setPw({ current: "", password: "", confirm: "" }); setMsg({ kind: "ok", text: "Password changed." }); } catch (e) { setMsg({ kind: "danger", text: (e as Error).message }); }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {msg && <div className="lg:col-span-2"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
      <Section title="Accounts">
        <table className="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th>{isOwner && <th></th>}</tr></thead>
          <tbody>{users.map((u) => <tr key={u.id}><td>{u.name}</td><td className="text-xs">{u.email}</td><td className="capitalize">{u.role}</td><td>{isOwner && u.id !== me.id ? <input type="checkbox" checked={u.active} onChange={(e) => patch(u, { active: e.target.checked })} /> : u.active ? "yes" : "no"}</td>{isOwner && <td>{u.id !== me.id && <button className="link text-xs" onClick={() => { const p = prompt(`New temporary password for ${u.name} (10+ characters):`); if (p) patch(u, { password: p }); }}>Reset password</button>}</td>}</tr>)}</tbody>
        </table>
        {isOwner && (
          <form onSubmit={create} className="mt-4 space-y-2">
            <div className="h3">Add user</div>
            <Row><Field label="Name"><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="Email"><input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field></Row>
            <Row><Field label="Temporary password (10+)"><input className="input" type="text" required minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field><Field label="Role"><select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "staff" | "owner" })}><option value="staff">Staff (Erika)</option><option value="owner">Owner</option></select></Field></Row>
            <button className="btn btn-primary">Create user</button>
          </form>
        )}
      </Section>
      <Section title="Change my password">
        <form onSubmit={changePw} className="space-y-2">
          <Field label="Current password"><input className="input" type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="New password (10+)"><input className="input" type="password" autoComplete="new-password" required minLength={10} value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></Field>
          <Field label="Confirm new password"><input className="input" type="password" autoComplete="new-password" required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
          <button className="btn btn-primary">Change password</button>
        </form>
      </Section>
    </div>
  );
}
