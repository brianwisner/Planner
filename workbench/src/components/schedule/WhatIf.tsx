"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { fmtDateShort, fmtHours } from "@/lib/format";
import { Notice } from "@/components/ui/Notice";
import { Pill } from "@/components/ui/Badges";
import type { ScenarioOverrides, ProposalSummary } from "@/lib/db/schema";
import { WorkloadChart } from "@/components/reports/Charts";

type Scenario = { id: number; name: string; overrides: ScenarioOverrides; updatedAt: string };
type P = { id: number; name: string; status: string; priority: number; remaining: number; clientDueDate: string | null; committed: boolean; tentativeReserve: boolean };
type Run = { baseline: { summary: ProposalSummary; dayLoad: { date: string; availableHours: number; plannedHours: number }[] }; whatIf: { summary: ProposalSummary; dayLoad: { date: string; availableHours: number; plannedHours: number }[] } };

export function WhatIf({ userId, projects }: { userId: number; projects: P[] }) {
  const router = useRouter();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [sel, setSel] = useState<Scenario | null>(null);
  const [ov, setOv] = useState<ScenarioOverrides>({});
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<{ scenarios: Scenario[] }>(`/api/scenarios?userId=${userId}`);
      setScenarios(r.scenarios);
    } catch (e) { setError((e as Error).message); }
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  function select(s: Scenario) { setSel(s); setOv(s.overrides ?? {}); setRun(null); }
  function setProj(id: number, patch: Record<string, unknown>) {
    setOv((o) => ({ ...o, projects: { ...(o.projects ?? {}), [id]: { ...(o.projects?.[String(id)] ?? {}), ...patch } } }));
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy("create");
    try {
      const r = await api<{ scenario: Scenario }>("/api/scenarios", { method: "POST", json: { userId, name } });
      setName("");
      await load();
      select(r.scenario);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function saveAndRun() {
    if (!sel) return;
    setBusy("run");
    setError(null);
    try {
      await api(`/api/scenarios/${sel.id}`, { method: "PATCH", json: { overrides: ov } });
      const r = await api<Run>(`/api/scenarios/${sel.id}/run`, { method: "POST" });
      setRun(r);
      load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function propose() {
    if (!sel) return;
    setBusy("propose");
    try {
      await api(`/api/scenarios/${sel.id}`, { method: "PATCH", json: { overrides: ov } });
      const r = await api<{ proposal: { id: number } }>(`/api/scenarios/${sel.id}/propose`, { method: "POST" });
      router.push(`/schedule/proposals/${r.proposal.id}`);
    } catch (e) { setError((e as Error).message); setBusy(null); }
  }
  async function remove(s: Scenario) {
    if (!confirm(`Delete scenario "${s.name}"?`)) return;
    await api(`/api/scenarios/${s.id}`, { method: "DELETE" });
    if (sel?.id === s.id) { setSel(null); setRun(null); }
    load();
  }
  const fc = (sum: ProposalSummary, id: number) => sum.forecasts.find((f) => f.projectId === id);

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      <div className="space-y-3">
        <div className="card">
          <div className="h3 mb-2">Scenarios</div>
          {scenarios.length === 0 && <p className="text-sm muted mb-2">None yet.</p>}
          <ul className="space-y-1">
            {scenarios.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <button className={`flex-1 text-left text-sm px-2 py-1.5 rounded-md ${sel?.id === s.id ? "bg-accent-soft text-accent" : "hover:bg-surface-2"}`} onClick={() => select(s)}>{s.name}</button>
                <button className="link text-xs" onClick={() => remove(s)}>✕</button>
              </li>
            ))}
          </ul>
          <form onSubmit={create} className="mt-3 flex gap-2">
            <input className="input min-h-[36px] py-1" placeholder="New scenario name" value={name} onChange={(e) => setName(e.target.value)} required />
            <button className="btn btn-sm" disabled={busy === "create"}>Add</button>
          </form>
        </div>
      </div>
      <div className="lg:col-span-3 space-y-4">
        {error && <Notice kind="danger">{error}</Notice>}
        {!sel ? <div className="card text-sm muted">Create or pick a scenario. Then change priorities, remaining hours, due dates, or capacity and run it to compare against the current plan.</div> : (
          <>
            <div className="card">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="h2">{sel.name}</h2>
                <div className="flex gap-2">
                  <button className="btn btn-primary" onClick={saveAndRun} disabled={!!busy}>{busy === "run" ? "Running…" : "Run scenario"}</button>
                  <button className="btn" onClick={propose} disabled={!!busy || !run}>Turn into proposal</button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-sm">
                <label className="block"><span className="label">Buffer %</span><input className="input" type="number" min={0} max={90} value={ov.capacity?.bufferPercent ?? ""} placeholder="current" onChange={(e) => setOv({ ...ov, capacity: { ...ov.capacity, bufferPercent: e.target.value === "" ? undefined : Number(e.target.value) } })} /></label>
                <label className="block"><span className="label">Max concurrent</span><input className="input" type="number" min={1} max={10} value={ov.capacity?.maxConcurrentProjects ?? ""} placeholder="current" onChange={(e) => setOv({ ...ov, capacity: { ...ov.capacity, maxConcurrentProjects: e.target.value === "" ? undefined : Number(e.target.value) } })} /></label>
                <label className="block"><span className="label">Extra h / day</span><input className="input" type="number" step="0.5" min={-12} max={12} value={ov.capacity?.extraHoursPerDay ?? ""} placeholder="0" onChange={(e) => setOv({ ...ov, capacity: { ...ov.capacity, extraHoursPerDay: e.target.value === "" ? undefined : Number(e.target.value) } })} /></label>
                <label className="block"><span className="label">Horizon days</span><input className="input" type="number" min={7} max={180} value={ov.horizonDays ?? ""} placeholder="current" onChange={(e) => setOv({ ...ov, horizonDays: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>
              </div>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Include</th><th>Project</th><th>Priority</th><th>Remaining h</th><th>Due</th>{run && <><th>Baseline</th><th>What-if</th></>}</tr></thead>
                  <tbody>
                    {projects.map((p) => {
                      const o = ov.projects?.[String(p.id)] ?? {};
                      const included = o.include ?? (p.committed || p.tentativeReserve);
                      const b = run ? fc(run.baseline.summary, p.id) : undefined;
                      const w = run ? fc(run.whatIf.summary, p.id) : undefined;
                      return (
                        <tr key={p.id} className={!included ? "opacity-60" : ""}>
                          <td><input type="checkbox" checked={included} onChange={(e) => setProj(p.id, { include: e.target.checked })} /></td>
                          <td><Link className="link" href={`/projects/${p.id}`}>{p.name}</Link><div className="text-xs muted">{p.status.replace("_", " ")}{!p.committed ? " (not committed)" : ""}</div></td>
                          <td><select className="select min-h-[32px] py-0.5 w-auto" value={o.priority ?? p.priority} onChange={(e) => setProj(p.id, { priority: Number(e.target.value) })}><option value={1}>Urgent</option><option value={2}>High</option><option value={3}>Normal</option><option value={4}>Low</option></select></td>
                          <td><input className="input min-h-[32px] py-0.5 w-20" type="number" step="0.5" value={o.remainingHours ?? p.remaining} onChange={(e) => setProj(p.id, { remainingHours: Number(e.target.value) })} /></td>
                          <td><input className="input min-h-[32px] py-0.5 w-36" type="date" value={o.clientDueDate !== undefined ? o.clientDueDate ?? "" : p.clientDueDate ?? ""} onChange={(e) => setProj(p.id, { clientDueDate: e.target.value || null })} /></td>
                          {run && (
                            <>
                              <td>{b ? (b.forecastCompletion ? fmtDateShort(b.forecastCompletion) : "beyond") : "–"}{b?.atRisk && <Pill tone="danger">risk</Pill>}</td>
                              <td className="font-medium">{w ? (w.forecastCompletion ? fmtDateShort(w.forecastCompletion) : "beyond") : "–"}{w?.atRisk && <Pill tone="danger">risk</Pill>}</td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            {run && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="card"><h3 className="h3 mb-2">Baseline (current data, current settings)</h3><WorkloadChart data={weekly(run.baseline.dayLoad)} />{run.baseline.summary.warnings.map((w, i) => <div key={i} className="text-xs text-warn mt-1">{w}</div>)}</div>
                <div className="card"><h3 className="h3 mb-2">What-if</h3><WorkloadChart data={weekly(run.whatIf.dayLoad)} />{run.whatIf.summary.warnings.map((w, i) => <div key={i} className="text-xs text-warn mt-1">{w}</div>)}{run.whatIf.summary.unscheduled.map((u) => <div key={u.projectId} className="text-xs muted mt-1">{u.projectName}: {u.reason}</div>)}</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function weekly(dayLoad: { date: string; availableHours: number; plannedHours: number }[]) {
  const out: { label: string; available: number; planned: number }[] = [];
  for (let i = 0; i < dayLoad.length; i += 7) {
    const chunk = dayLoad.slice(i, i + 7);
    out.push({ label: `Wk of ${fmtDateShort(chunk[0].date)}`, available: Math.round(chunk.reduce((s, d) => s + d.availableHours, 0) * 10) / 10, planned: Math.round(chunk.reduce((s, d) => s + d.plannedHours, 0) * 10) / 10 });
  }
  return out;
}

export const unusedHours = fmtHours;
