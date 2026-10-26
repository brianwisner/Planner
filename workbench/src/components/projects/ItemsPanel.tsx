"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Section } from "@/components/ui/Form";
import { Pill } from "@/components/ui/Badges";
import { fmtDate, fmtHours, fmtMoney } from "@/lib/format";

type Item = { id: number; kind: "waiting" | "blocker" | "scope_change"; description: string; status: "open" | "resolved"; hoursAdded: string | null; feeAdded: string | null; blocksScheduling: boolean; createdAt: Date | string; resolvedAt: Date | string | null; createdByName?: string | null };

export function ItemsPanel({ projectId, items }: { projectId: number; items: Item[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<Item["kind"]>("waiting");
  const [desc, setDesc] = useState("");
  const [hours, setHours] = useState("");
  const [fee, setFee] = useState("");
  const [blocks, setBlocks] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api(`/api/projects/${projectId}/items`, { method: "POST", json: { kind, description: desc, hoursAdded: kind === "scope_change" && hours ? Number(hours) : null, feeAdded: kind === "scope_change" && fee ? Number(fee) : null, blocksScheduling: kind === "blocker" ? true : blocks } });
      setDesc(""); setHours(""); setFee(""); setBlocks(false);
      router.refresh();
    } catch (e) { setErr((e as Error).message); }
  }
  async function setStatus(it: Item, status: "open" | "resolved") {
    await api(`/api/items/${it.id}`, { method: "PATCH", json: { status } });
    router.refresh();
  }
  const visible = items.filter((i) => showResolved || i.status === "open" || i.kind === "scope_change");
  const label = { waiting: "Waiting on", blocker: "Blocker", scope_change: "Scope change" };
  const tone = { waiting: "warn", blocker: "danger", scope_change: "info" } as const;

  return (
    <Section title="Waiting, blockers & scope changes" actions={<label className="text-xs flex items-center gap-1"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> show resolved</label>}>
      {visible.length === 0 ? <p className="text-sm muted mb-2">Nothing open. Record what you are waiting on, what blocks the work, and any scope added after the original estimate.</p> : (
        <ul className="divide-y divide-line mb-3">
          {visible.map((it) => (
            <li key={it.id} className="py-2 text-sm flex items-start gap-2">
              <Pill tone={it.status === "resolved" ? "muted" : tone[it.kind]}>{label[it.kind]}</Pill>
              <div className="flex-1">
                <div className={it.status === "resolved" ? "line-through muted" : ""}>{it.description}</div>
                <div className="text-xs muted">{fmtDate(it.createdAt as string)}{it.createdByName ? ` · ${it.createdByName}` : ""}{it.kind === "scope_change" && (it.hoursAdded || it.feeAdded) ? ` · +${fmtHours(it.hoursAdded)} ${it.feeAdded ? `/ +${fmtMoney(it.feeAdded)}` : ""}` : ""}{it.blocksScheduling && it.status === "open" ? " · holds scheduling" : ""}</div>
              </div>
              {it.kind !== "scope_change" && (it.status === "open" ? <button className="btn btn-sm" onClick={() => setStatus(it, "resolved")}>Resolve</button> : <button className="link text-xs" onClick={() => setStatus(it, "open")}>Reopen</button>)}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap gap-2 items-center">
        <select className="select w-auto" value={kind} onChange={(e) => setKind(e.target.value as Item["kind"])}>
          <option value="waiting">Waiting on…</option><option value="blocker">Blocker</option><option value="scope_change">Scope change</option>
        </select>
        <input className="input flex-1 min-w-[180px]" placeholder={kind === "scope_change" ? "What was added?" : kind === "blocker" ? "What is blocking the work?" : "What are you waiting for?"} value={desc} onChange={(e) => setDesc(e.target.value)} required />
        {kind === "scope_change" && (<><input className="input w-24" type="number" step="0.25" placeholder="+ hours" value={hours} onChange={(e) => setHours(e.target.value)} /><input className="input w-28" type="number" step="1" placeholder="+ fee $" value={fee} onChange={(e) => setFee(e.target.value)} /></>)}
        {kind === "waiting" && <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={blocks} onChange={(e) => setBlocks(e.target.checked)} /> holds scheduling</label>}
        <button className="btn btn-sm">Add</button>
      </form>
      {err && <div className="text-sm text-danger mt-2">{err}</div>}
    </Section>
  );
}
