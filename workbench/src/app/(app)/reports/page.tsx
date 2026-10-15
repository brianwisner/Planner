import Link from "next/link";
import { DateTime } from "luxon";
import { requireUser } from "@/lib/auth/session";
import { getOwnerId } from "@/lib/services/users";
import { accuracyByType, deadlinesReport, estimateVsActual, timeByProject, workloadReport } from "@/lib/services/reports";
import { PageHeader } from "@/components/ui/PageHeader";
import { AccuracyChart, EstVsActualChart, WorkloadChart } from "@/components/reports/Charts";
import { fmtDateShort, fmtHours, fmtMinutes } from "@/lib/format";
import { Pill, StatusBadge } from "@/components/ui/Badges";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const user = await requireUser();
  const ownerId = (await getOwnerId()) ?? user.id;
  const monthStart = DateTime.now().setZone(user.timezone).startOf("month").toISODate()!;
  const today = DateTime.now().setZone(user.timezone).toISODate()!;
  const [workload, eva, acc, deadlines, timeMonth] = await Promise.all([workloadReport(ownerId, user.timezone), estimateVsActual(), accuracyByType(), deadlinesReport(user.timezone), timeByProject(monthStart, today)]);
  const remainingTotal = eva.reduce((s, p) => s + p.remaining, 0);
  const availableTotal = workload.reduce((s, w) => s + w.available, 0);
  return (
    <div className="space-y-4">
      <PageHeader title="Reports" subtitle="Built from the records you keep here. Reports get more useful as projects complete." actions={<Link href="/settings/data" className="btn">Export data</Link>} />

      <section className="card">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2"><h2 className="h2">Workload vs capacity (next 8 weeks)</h2><span className="text-sm muted">{fmtHours(remainingTotal)} remaining on committed work · {fmtHours(availableTotal)} available</span></div>
        {workload.every((w) => w.planned === 0) ? <p className="text-sm muted">Nothing scheduled yet. Accept a recommendation on the Schedule page to see planned hours against capacity.</p> : <WorkloadChart data={workload} />}
        {workload.some((w) => w.overbookedDays > 0) && <p className="text-xs text-danger mt-1">Overbooked days: {workload.filter((w) => w.overbookedDays).map((w) => `${w.label} (${w.overbookedDays})`).join(", ")}</p>}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="h2 mb-2">Estimated vs actual vs remaining</h2>
          {eva.length === 0 ? <p className="text-sm muted">No projects with estimates or logged time yet.</p> : (
            <>
              <EstVsActualChart data={eva.slice(0, 12).map((p) => ({ name: p.name.length > 22 ? p.name.slice(0, 21) + "…" : p.name, estimated: p.estimated, actual: p.actual, remaining: p.remaining }))} />
              <div className="overflow-x-auto"><table className="table mt-2 text-xs">
                <thead><tr><th>Project</th><th>Est</th><th>Actual</th><th>Remaining</th><th>Projected</th></tr></thead>
                <tbody>{eva.slice(0, 20).map((p) => { const proj = p.actual + p.remaining; return <tr key={p.id}><td><Link className="link" href={`/projects/${p.id}`}>{p.name}</Link> <StatusBadge status={p.status} /></td><td>{fmtHours(p.estimated)}</td><td>{fmtHours(p.actual)}</td><td>{fmtHours(p.remaining)}</td><td className={p.estimated && proj > p.estimated * 1.1 ? "text-danger" : ""}>{fmtHours(proj)}{p.estimated ? ` (${Math.round((proj / p.estimated) * 100)}%)` : ""}</td></tr>; })}</tbody>
              </table></div>
            </>
          )}
        </section>
        <section className="card">
          <h2 className="h2 mb-2">Approaching deadlines (45 days)</h2>
          {deadlines.length === 0 ? <p className="text-sm muted">No due dates or targets in the next 45 days.</p> : (
            <div className="overflow-x-auto"><table className="table text-sm">
              <thead><tr><th>Project</th><th>Due</th><th>Left</th><th>Forecast</th></tr></thead>
              <tbody>{deadlines.map((p) => { const late = p.forecast && p.forecast > p.due; const none = p.committed && p.remaining > 0 && (!p.forecast || p.forecast < today); return <tr key={p.id}><td><Link className="link" href={`/projects/${p.id}`}>{p.name}</Link><div className="text-xs muted">{p.clientName}</div></td><td>{fmtDateShort(p.due)} <span className="text-xs muted">{p.kind}</span></td><td className={p.daysLeft < 0 ? "text-danger" : ""}>{p.daysLeft < 0 ? `${-p.daysLeft} d overdue` : `${p.daysLeft} d`}<div className="text-xs muted">{fmtHours(p.remaining)} work</div></td><td>{!p.committed ? <Pill>not committed</Pill> : none ? <Pill tone="warn">not scheduled</Pill> : late ? <Pill tone="danger">{fmtDateShort(p.forecast)}</Pill> : <Pill tone="ok">{fmtDateShort(p.forecast)}</Pill>}</td></tr>; })}</tbody>
            </table></div>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="h2 mb-1">Estimating accuracy by project type</h2>
          <p className="text-xs muted mb-2">Actual hours (minus added scope) ÷ approved original estimate, for completed projects. 1.0 means on estimate.</p>
          {acc.length === 0 ? <p className="text-sm muted">No completed projects with an approved estimate and logged time yet. This report fills in as projects finish.</p> : (
            <>
              <AccuracyChart data={acc} />
              <ul className="text-xs mt-2 space-y-1">{acc.map((a) => <li key={a.type}><strong>{a.type}</strong>: {a.ratio}× over {a.count} project{a.count > 1 ? "s" : ""} — {a.projects.map((p) => `${p.name} ${p.actual}/${p.estimated} h`).join("; ")}</li>)}</ul>
            </>
          )}
        </section>
        <section className="card">
          <h2 className="h2 mb-2">Time this month by project</h2>
          {timeMonth.length === 0 ? <p className="text-sm muted">No time logged this month.</p> : (
            <div className="overflow-x-auto"><table className="table text-sm"><thead><tr><th>Project</th><th>Total</th><th>Billable</th></tr></thead><tbody>{timeMonth.map((t) => <tr key={t.projectId}><td><Link className="link" href={`/projects/${t.projectId}`}>{t.name}</Link></td><td>{fmtMinutes(t.minutes)}</td><td>{fmtMinutes(t.billable)}</td></tr>)}</tbody></table></div>
          )}
        </section>
      </div>
    </div>
  );
}
