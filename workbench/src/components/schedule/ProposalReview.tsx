"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { api } from "@/lib/client/api";
import { fmtDateShort, fmtHours } from "@/lib/format";
import { Notice } from "@/components/ui/Notice";
import { Pill, StatusBadge } from "@/components/ui/Badges";
import type { ProposalBlock, ProposalSummary } from "@/lib/db/schema";
import { WeekLoadChart } from "@/components/reports/Charts";

type Proposal = { id: number; status: string; title: string; blocks: ProposalBlock[]; summary: ProposalSummary; createdAt: string; decidedAt: string | null };

export function ProposalReview({ proposal, projectNames, days, isOwner }: { proposal: Proposal; projectNames: Record<number, string>; days: { date: string; availableHours: number; off: boolean }[]; isOwner: boolean }) {
  const router = useRouter();
  const [blocks, setBlocks] = useState<ProposalBlock[]>(proposal.blocks);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = proposal.status === "proposed";
  const s = proposal.summary;

  const byDate = useMemo(() => {
    const m = new Map<string, ProposalBlock[]>();
    for (const b of blocks) m.set(b.date, [...(m.get(b.date) ?? []), b]);
    return m;
  }, [blocks]);
  const loadData = days.map((d) => ({ date: d.date, available: d.availableHours, planned: (byDate.get(d.date) ?? []).reduce((x, b) => x + b.hours, 0), off: d.off }));
  const lastPlanned = blocks.map((b) => b.date).sort().pop() ?? "";
  const activeDays = days.filter((d) => (!d.off && d.date <= lastPlanned) || (byDate.get(d.date)?.length ?? 0) > 0);

  function setHours(idx: number, hours: number) {
    setBlocks((bs) => bs.map((b, i) => (i === idx ? { ...b, hours } : b)));
    setDirty(true);
  }
  async function act(label: string, fn: () => Promise<unknown>, then?: string) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      if (then) router.push(then);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const saveAdjust = () => act("save", () => api(`/api/proposals/${proposal.id}`, { method: "PATCH", json: { blocks } }));
  const accept = () => act("accept", async () => { if (dirty) await api(`/api/proposals/${proposal.id}`, { method: "PATCH", json: { blocks } }); await api(`/api/proposals/${proposal.id}/accept`, { method: "POST" }); }, "/schedule");
  const reject = () => act("reject", () => api(`/api/proposals/${proposal.id}/reject`, { method: "POST" }), "/schedule/proposals");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={proposal.status === "proposed" ? "proposed_schedule" : proposal.status} />
        {open && isOwner && (
          <>
            <button className="btn btn-primary" onClick={accept} disabled={!!busy}>{busy === "accept" ? "Applying…" : dirty ? "Accept with my adjustments" : "Accept and apply"}</button>
            <button className="btn btn-danger" onClick={reject} disabled={!!busy}>Reject</button>
          </>
        )}
        {open && dirty && <button className="btn" onClick={saveAdjust} disabled={!!busy}>Save adjustments</button>}
        {open && !isOwner && <span className="text-sm muted">Only Brian can accept this. You can adjust and save it for his review.</span>}
        {!open && <span className="text-sm muted">This proposal is {proposal.status}{proposal.decidedAt ? ` (${DateTime.fromISO(proposal.decidedAt).toFormat("LLL d, h:mm a")})` : ""}.</span>}
      </div>
      {error && <Notice kind="danger">{error}</Notice>}
      {s.warnings.length > 0 && <Notice kind="warn"><ul className="list-disc pl-4">{s.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Notice>}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="h2 mb-2">What would change ({s.moves.length})</h2>
          {s.moves.length === 0 ? <p className="text-sm muted">No changes compared with the current approved schedule.</p> : (
            <ul className="divide-y divide-line text-sm">
              {s.moves.map((m, i) => (
                <li key={i} className="py-2"><Link className="link font-medium" href={`/projects/${m.projectId}`}>{m.projectName}</Link><div>{m.change}</div><div className="text-xs muted">Why: {m.reason}</div></li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2 className="h2 mb-2">Completion forecasts</h2>
          <p className="text-xs muted mb-2">Forecast = last scheduled day. A client due date is a commitment; a forecast is what the plan predicts.</p>
          <table className="table">
            <thead><tr><th>Project</th><th>Forecast</th><th className="hidden sm:table-cell">Was</th><th>Due</th><th></th></tr></thead>
            <tbody>
              {s.forecasts.map((f) => (
                <tr key={f.projectId}>
                  <td><Link className="link" href={`/projects/${f.projectId}`}>{f.projectName}</Link></td>
                  <td>{f.forecastCompletion ? fmtDateShort(f.forecastCompletion) : <span className="muted">beyond window</span>}</td>
                  <td className="hidden sm:table-cell muted">{f.previousForecast ? fmtDateShort(f.previousForecast) : "–"}</td>
                  <td>{f.clientDueDate ? fmtDateShort(f.clientDueDate) : f.targetCompletion ? <span className="muted">{fmtDateShort(f.targetCompletion)} (target)</span> : "–"}</td>
                  <td>{f.atRisk ? <Pill tone="danger">at risk</Pill> : f.forecastCompletion ? <Pill tone="ok">ok</Pill> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {s.unscheduled.length > 0 && (
            <div className="mt-3 text-sm"><div className="h3 mb-1">Not scheduled</div><ul className="list-disc pl-4">{s.unscheduled.map((u) => <li key={u.projectId}><Link className="link" href={`/projects/${u.projectId}`}>{u.projectName}</Link>: {u.reason}</li>)}</ul></div>
          )}
        </section>
      </div>

      <section className="card">
        <h2 className="h2 mb-2">Planned vs available</h2>
        <WeekLoadChart data={loadData.slice(0, 14)} />
      </section>

      <section className="card">
        <h2 className="h2 mb-1">Proposed blocks</h2>
        <p className="text-xs muted mb-3">{open ? "Adjust hours before deciding. Set hours to 0 to drop a block. 🔒 blocks are locked in the approved schedule and are kept as-is." : "Blocks as proposed."}</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {activeDays.map((d) => {
            const list = blocks.map((b, i) => ({ b, i })).filter((x) => x.b.date === d.date);
            const planned = Math.round(list.reduce((x, y) => x + y.b.hours, 0) * 100) / 100;
            return (
              <div key={d.date} className={`rounded-lg border border-line p-2 ${planned > d.availableHours + 0.001 ? "bg-danger-soft" : ""}`}>
                <div className="flex justify-between text-sm"><span className="font-medium">{fmtDateShort(d.date)}</span><span className="muted">{planned}/{d.availableHours} h</span></div>
                {list.length === 0 ? <div className="text-xs muted">—</div> : list.map(({ b, i }) => (
                  <div key={i} className="flex items-center gap-2 text-sm py-0.5">
                    <span className="flex-1 truncate">{b.locked && "🔒 "}{projectNames[b.projectId] ?? `#${b.projectId}`}</span>
                    {open && !b.locked ? <input type="number" className="input !w-24 shrink-0 min-h-[32px] py-0.5" aria-label={`Hours for ${projectNames[b.projectId] ?? b.projectId} on ${d.date}`} step="0.25" min="0" value={b.hours} onChange={(e) => setHours(i, Number(e.target.value))} /> : <span>{fmtHours(b.hours)}</span>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
