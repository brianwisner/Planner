"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { fmtHours, fmtMoney } from "@/lib/format";
import { Field, Row } from "@/components/ui/Form";
import { Notice } from "@/components/ui/Notice";
import { Pill } from "@/components/ui/Badges";
import type { EstimateRecommendation } from "@/lib/engine/estimates";

type Line = { phase: string; description: string; hours: number; rate: number | null };
type Project = { id: number; name: string; clientName: string; projectTypeId: number | null; status: string };
type Rate = { id: number; name: string; rate: string; isDefault: boolean; active: boolean };
export type EstimateInit = { id?: number; version?: number; projectId: number | null; title: string; scopeKind: "original" | "added"; feeType: "hourly" | "fixed"; hourlyRate: number | null; lines: Line[]; assumptions: string; exclusions: string; notes: string; fixedTotal: number | null; supersedesId?: number | null };

export function EstimateEditor({ initial, rates }: { initial: EstimateInit; rates: Rate[] }) {
  const router = useRouter();
  const [v, setV] = useState<EstimateInit>(initial);
  const [projects, setProjects] = useState<Project[]>([]);
  const [rec, setRec] = useState<EstimateRecommendation | null>(null);
  const [recBusy, setRecBusy] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const defaultRate = Number(rates.find((r) => r.isDefault)?.rate ?? rates[0]?.rate ?? 150);

  useEffect(() => {
    api<{ projects: Project[] }>("/api/projects?status=all").then((r) => setProjects(r.projects.filter((p) => !["completed", "declined"].includes(p.status) || p.id === initial.projectId))).catch(() => {});
  }, [initial.projectId]);
  useEffect(() => {
    if (v.hourlyRate == null) setV((s) => ({ ...s, hourlyRate: defaultRate }));
  }, [defaultRate, v.hourlyRate]);

  const loadRec = useCallback(async (projectId: number) => {
    setRecBusy(true);
    try {
      const r = await api<{ recommendation: EstimateRecommendation }>(`/api/estimates/recommend?projectId=${projectId}`);
      setRec(r.recommendation);
    } catch { setRec(null); } finally { setRecBusy(false); }
  }, []);
  useEffect(() => { if (v.projectId) loadRec(v.projectId); }, [v.projectId, loadRec]);

  const rate = v.hourlyRate ?? defaultRate;
  const totalHours = v.lines.reduce((s, l) => s + (Number(l.hours) || 0), 0);
  const linesTotal = v.lines.reduce((s, l) => s + (Number(l.hours) || 0) * (l.rate ?? rate), 0);
  const totalFee = v.feeType === "fixed" && v.fixedTotal != null ? v.fixedTotal : linesTotal;
  const setLine = (i: number, patch: Partial<Line>) => setV((s) => ({ ...s, lines: s.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  async function loadTemplateTasks() {
    if (!v.projectId) return;
    const r = await api<{ project: { tasks: { name: string; phase: string | null; estimatedHours: string | null }[] } }>(`/api/projects/${v.projectId}`);
    const lines = r.project.tasks.map((t) => ({ phase: t.phase ?? "", description: t.name, hours: Number(t.estimatedHours ?? 0), rate: null }));
    if (lines.length) setV((s) => ({ ...s, lines }));
    else setError("This project has no tasks to import. Add tasks on the project page or type lines below.");
  }
  function applyRecommendation(which: "low" | "mid" | "high") {
    if (!rec?.hours) return;
    const target = rec.hours[which];
    const cur = totalHours;
    if (cur > 0) setV((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l, hours: Math.round((l.hours / cur) * target * 4) / 4 })), fixedTotal: s.feeType === "fixed" && rec.fee ? rec.fee[which] : s.fixedTotal }));
    else setV((s) => ({ ...s, lines: [{ phase: "", description: "Engineering services", hours: target, rate: null }], fixedTotal: s.feeType === "fixed" && rec.fee ? rec.fee[which] : s.fixedTotal }));
  }
  async function save(submit: boolean) {
    if (!v.projectId) return setError("Choose a project first.");
    setBusy(submit ? "submit" : "save");
    setError(null);
    const payload = { projectId: v.projectId, title: v.title || null, scopeKind: v.scopeKind, feeType: v.feeType, hourlyRate: rate, lines: v.lines.filter((l) => l.description).map((l) => ({ phase: l.phase || null, description: l.description, hours: Number(l.hours) || 0, rate: l.rate })), assumptions: v.assumptions || null, exclusions: v.exclusions || null, notes: v.notes || null, fixedTotal: v.feeType === "fixed" ? v.fixedTotal : null, recommendation: rec, supersedesId: v.supersedesId ?? null };
    try {
      let id = v.id;
      if (id) {
        const { projectId: _p, supersedesId: _s, ...rest } = payload;
        const r = await api<{ estimate: { id: number; version: number } }>(`/api/estimates/${id}`, { method: "PATCH", json: { ...rest, version: v.version } });
        setV((s) => ({ ...s, version: r.estimate.version }));
      } else {
        const r = await api<{ estimate: { id: number } }>("/api/estimates", { method: "POST", json: payload });
        id = r.estimate.id;
      }
      if (submit) await api(`/api/estimates/${id}/submit`, { method: "POST" });
      router.push(`/estimates/${id}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        {error && <Notice kind="danger">{error}</Notice>}
        <div className="card space-y-3">
          <Row>
            <Field label="Project *">
              <select className="select" value={v.projectId ?? ""} disabled={!!v.id} onChange={(e) => setV({ ...v, projectId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Choose…</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.clientName}</option>)}
              </select>
            </Field>
            <Field label="Title"><input className="input" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="Structural engineering services" /></Field>
          </Row>
          <Row cols={3}>
            <Field label="Scope kind" hint="Keep added scope separate so history stays comparable.">
              <select className="select" value={v.scopeKind} onChange={(e) => setV({ ...v, scopeKind: e.target.value as "original" | "added" })}><option value="original">Original scope</option><option value="added">Added scope</option></select>
            </Field>
            <Field label="Fee basis"><select className="select" value={v.feeType} onChange={(e) => setV({ ...v, feeType: e.target.value as "hourly" | "fixed" })}><option value="fixed">Fixed fee</option><option value="hourly">Hourly</option></select></Field>
            <Field label="Default rate ($/h)">
              <select className="select" value={rate} onChange={(e) => setV({ ...v, hourlyRate: Number(e.target.value) })}>
                {rates.filter((r) => r.active).map((r) => <option key={r.id} value={Number(r.rate)}>{r.name} — ${Number(r.rate)}</option>)}
                {!rates.some((r) => Number(r.rate) === rate) && <option value={rate}>${rate}</option>}
              </select>
            </Field>
          </Row>
        </div>
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h2 className="h2">Phases & tasks</h2>
            <div className="flex gap-2"><button type="button" className="btn btn-sm" onClick={loadTemplateTasks} disabled={!v.projectId}>Import project tasks</button><button type="button" className="btn btn-sm" onClick={() => setV({ ...v, lines: [...v.lines, { phase: "", description: "", hours: 0, rate: null }] })}>Add line</button></div>
          </div>
          <div className="space-y-2">
            {v.lines.length === 0 && <p className="text-sm muted">No lines yet. Import the project&apos;s task list or add lines.</p>}
            {v.lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <input className="input col-span-3 sm:col-span-2 min-h-[36px] py-1" placeholder="Phase" value={l.phase} onChange={(e) => setLine(i, { phase: e.target.value })} />
                <input className="input col-span-9 sm:col-span-5 min-h-[36px] py-1" placeholder="Description" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                <input className="input col-span-4 sm:col-span-2 min-h-[36px] py-1" type="number" step="0.25" min="0" value={l.hours} onChange={(e) => setLine(i, { hours: Number(e.target.value) })} aria-label="Hours" inputMode="decimal" />
                <input className="input col-span-4 sm:col-span-2 min-h-[36px] py-1" type="number" step="1" min="0" value={l.rate ?? ""} placeholder={`$${rate}`} onChange={(e) => setLine(i, { rate: e.target.value === "" ? null : Number(e.target.value) })} aria-label="Rate" />
                <div className="col-span-3 sm:col-span-1 text-right text-sm">{fmtMoney((Number(l.hours) || 0) * (l.rate ?? rate))}</div>
                <button type="button" className="col-span-1 link text-xs" onClick={() => setV({ ...v, lines: v.lines.filter((_, j) => j !== i) })} aria-label="Remove line">✕</button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-4 text-sm">
            <span>{fmtHours(totalHours)} total</span>
            <span>Lines: {fmtMoney(linesTotal)}</span>
            {v.feeType === "fixed" && (
              <label className="flex items-center gap-2">Fixed fee $<input className="input w-32 min-h-[36px] py-1" type="number" step="1" min="0" value={v.fixedTotal ?? ""} placeholder={String(Math.round(linesTotal))} onChange={(e) => setV({ ...v, fixedTotal: e.target.value === "" ? null : Number(e.target.value) })} /></label>
            )}
            <strong className="text-base">Total {fmtMoney(totalFee)}</strong>
          </div>
        </div>
        <div className="card space-y-3">
          <Field label="Assumptions"><textarea className="textarea" value={v.assumptions} onChange={(e) => setV({ ...v, assumptions: e.target.value })} placeholder="Site conditions, drawings provided by others, number of review rounds…" /></Field>
          <Field label="Exclusions"><textarea className="textarea" value={v.exclusions} onChange={(e) => setV({ ...v, exclusions: e.target.value })} placeholder="Geotechnical, surveying, construction observation…" /></Field>
          <Field label="Internal notes"><textarea className="textarea min-h-[60px]" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => save(false)} disabled={!!busy}>{busy === "save" ? "Saving…" : "Save draft"}</button>
          <button className="btn btn-primary" onClick={() => save(true)} disabled={!!busy}>{busy === "submit" ? "Submitting…" : "Save & submit for approval"}</button>
          {v.id && <Link href={`/estimates/${v.id}`} className="btn">Cancel</Link>}
        </div>
      </div>

      <aside className="space-y-4">
        <div className="card">
          <h2 className="h2 mb-1">Similar completed projects</h2>
          {!v.projectId ? <p className="text-sm muted">Choose a project to see suggestions.</p> : recBusy ? <p className="text-sm muted">Looking…</p> : !rec ? <p className="text-sm muted">No recommendation available.</p> : (
            <div className="text-sm space-y-2">
              <div className="flex items-center gap-2"><Pill tone={rec.evidence === "strong" ? "ok" : rec.evidence === "moderate" ? "info" : rec.evidence === "weak" ? "warn" : "muted"}>{rec.basis === "history" ? `${rec.evidence} evidence` : rec.basis === "template" ? "template default" : "no basis"}</Pill><span className="muted">{rec.comparableCount} comparable</span></div>
              <p>{rec.message}</p>
              {rec.hours && (
                <div className="rounded-lg bg-surface-2 p-2">
                  <div className="grid grid-cols-3 text-center">
                    {(["low", "mid", "high"] as const).map((k) => (
                      <button key={k} type="button" className="rounded-md py-1 hover:bg-surface" onClick={() => applyRecommendation(k)} title="Scale the lines to this total">
                        <div className="text-[11px] uppercase muted">{k}</div>
                        <div className="font-semibold">{fmtHours(rec.hours![k])}</div>
                        {rec.fee && <div className="text-xs">{fmtMoney(rec.fee[k])}</div>}
                      </button>
                    ))}
                  </div>
                  <div className="text-[11px] muted text-center mt-1">Tap a value to scale your lines to it. You can still edit everything.</div>
                </div>
              )}
              <div className="text-xs"><strong>Estimating accuracy:</strong> {rec.accuracy.note}</div>
              {rec.assumptions.length > 0 && <ul className="text-xs muted list-disc pl-4">{rec.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>}
              {rec.comparables.length > 0 && (
                <div>
                  <div className="h3 mt-2 mb-1">Informed by</div>
                  <ul className="space-y-1 text-xs">
                    {rec.comparables.map((c) => (
                      <li key={c.id}><Link className="link" href={`/projects/${c.id}`}>{c.name}</Link> · {fmtHours(c.originalScopeHours)} actual{c.estimatedHours ? ` (est ${fmtHours(c.estimatedHours)})` : ""}{c.feeAmount ? ` · ${fmtMoney(c.feeAmount)}` : ""}{c.differences.length > 0 && <div className="muted">{c.differences.join("; ")}</div>}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
