"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";

type R = { id: number; name: string; rate: string; active: boolean; isDefault: boolean };
export function RatesEditor({ rates }: { rates: R[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    try { await api("/api/rates", { method: "POST", json: { name, rate: Number(rate), isDefault: rates.length === 0 } }); setName(""); setRate(""); router.refresh(); } catch (e) { setErr((e as Error).message); }
  }
  async function patch(r: R, body: Record<string, unknown>) {
    try { await api(`/api/rates/${r.id}`, { method: "PATCH", json: body }); router.refresh(); } catch (e) { setErr((e as Error).message); }
  }
  return (
    <div className="card max-w-xl">
      <table className="table mb-3"><thead><tr><th>Name</th><th>$/hour</th><th>Default</th><th>Active</th></tr></thead>
        <tbody>{rates.map((r) => <tr key={r.id}><td>{r.name}</td><td><input className="input w-24 min-h-[32px] py-0.5" type="number" defaultValue={Number(r.rate)} onBlur={(e) => Number(e.target.value) !== Number(r.rate) && patch(r, { rate: Number(e.target.value) })} /></td><td><input type="radio" name="default" checked={r.isDefault} onChange={() => patch(r, { isDefault: true })} /></td><td><input type="checkbox" checked={r.active} onChange={(e) => patch(r, { active: e.target.checked })} /></td></tr>)}</tbody>
      </table>
      <form onSubmit={add} className="flex gap-2"><input className="input" placeholder="Rate name" value={name} onChange={(e) => setName(e.target.value)} required /><input className="input w-28" type="number" placeholder="$/h" value={rate} onChange={(e) => setRate(e.target.value)} required /><button className="btn btn-primary">Add</button></form>
      {err && <div className="text-sm text-danger mt-2">{err}</div>}
    </div>
  );
}
