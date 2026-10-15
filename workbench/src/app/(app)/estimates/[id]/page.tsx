import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { estimates, auditLog, users } from "@/lib/db/schema";
import { getEstimateFull } from "@/lib/services/estimates";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/Badges";
import { EstimateActions } from "@/components/estimates/EstimateActions";
import { fmtDate, fmtHours, fmtMoney } from "@/lib/format";
import { HistoryList } from "@/components/shared/History";
import type { EstimateRecommendation } from "@/lib/engine/estimates";

export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const e = await getEstimateFull(Number(id));
  if (!e) notFound();
  const others = await db.select({ id: estimates.id, revision: estimates.revision, status: estimates.status, totalHours: estimates.totalHours, totalFee: estimates.totalFee, scopeKind: estimates.scopeKind, createdAt: estimates.createdAt }).from(estimates).where(eq(estimates.projectId, e.projectId)).orderBy(desc(estimates.revision));
  const history = await db.select({ id: auditLog.id, at: auditLog.at, action: auditLog.action, summary: auditLog.summary, userName: users.name }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId)).where(and(eq(auditLog.entityType, "estimate"), eq(auditLog.entityId, String(e.id)))).orderBy(desc(auditLog.at));
  const rec = e.recommendation as EstimateRecommendation | null;
  const phases = Array.from(new Set(e.lines.map((l) => l.phase ?? "")));
  return (
    <div>
      <div className="no-print">
        <PageHeader
          title={<span>Estimate rev {e.revision} <StatusBadge status={e.status} /></span>}
          subtitle={<span><Link className="link" href={`/projects/${e.projectId}`}>{e.projectName}</Link> · {e.clientName}{e.scopeKind === "added" ? " · added scope" : ""}</span>}
          back={<Link href="/estimates" className="link">← Estimates</Link>}
          actions={<EstimateActions id={e.id} status={e.status} isOwner={user.role === "owner"} />}
        />
      </div>

      {/* Printable summary */}
      <div className="card max-w-3xl print:max-w-none print:border-0" id="estimate-print">
        <div className="flex justify-between items-start mb-6">
          <div>
            <div className="text-lg font-semibold">Wisner Engineering, LLC</div>
            <div className="text-sm muted">Structural Engineering · Astoria, Oregon</div>
          </div>
          <div className="text-right text-sm">
            <div className="font-semibold">Fee Estimate{e.revision > 1 ? ` (Rev ${e.revision})` : ""}</div>
            <div className="muted">{fmtDate(e.approvedAt ?? e.submittedAt ?? e.createdAt)}</div>
            <div className="muted">#{e.id}</div>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4 text-sm mb-6">
          <div><div className="label">Prepared for</div><div className="font-medium">{e.clientName}</div>{e.clientCompany && <div>{e.clientCompany}</div>}{e.clientAddress && <div>{e.clientAddress}</div>}{e.clientEmail && <div>{e.clientEmail}</div>}</div>
          <div><div className="label">Project</div><div className="font-medium">{e.projectName}</div>{e.projectAddress && <div>{e.projectAddress}</div>}{e.projectTypeName && <div className="muted">{e.projectTypeName}</div>}</div>
        </div>
        {(e.title || e.projectScope) && <div className="mb-6 text-sm"><div className="label">Scope of services</div><div className="font-medium">{e.title}</div><div className="whitespace-pre-wrap">{e.projectScope}</div></div>}
        <table className="table mb-4">
          <thead><tr><th>Phase / task</th><th className="text-right">Hours</th>{e.feeType === "hourly" && <th className="text-right">Rate</th>}<th className="text-right">Amount</th></tr></thead>
          <tbody>
            {phases.map((ph) => (
              <Fragment key={ph || "none"}>
                {ph && <tr><td colSpan={4} className="font-medium bg-surface-2">{ph}</td></tr>}
                {e.lines.filter((l) => (l.phase ?? "") === ph).map((l) => (
                  <tr key={l.id}><td>{l.description}</td><td className="text-right">{Number(l.hours)}</td>{e.feeType === "hourly" && <td className="text-right">{fmtMoney(l.rate)}</td>}<td className="text-right">{fmtMoney(l.amount)}</td></tr>
                ))}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold"><td>Total</td><td className="text-right">{fmtHours(e.totalHours)}</td>{e.feeType === "hourly" && <td />}<td className="text-right text-base">{fmtMoney(e.totalFee)}</td></tr>
          </tfoot>
        </table>
        <div className="text-sm mb-4">{e.feeType === "fixed" ? <span><strong>Fixed fee.</strong> Hours shown are the basis of the fee and are not billed separately.</span> : <span><strong>Hourly.</strong> Billed at the rates shown; hours are an estimate, not a cap.</span>}</div>
        {e.assumptions && <div className="text-sm mb-3"><div className="label">Assumptions</div><div className="whitespace-pre-wrap">{e.assumptions}</div></div>}
        {e.exclusions && <div className="text-sm mb-3"><div className="label">Exclusions</div><div className="whitespace-pre-wrap">{e.exclusions}</div></div>}
        <div className="text-xs muted mt-6">Prepared by {e.preparedByName}{e.approvedByName ? ` · Approved by ${e.approvedByName} on ${fmtDate(e.approvedAt)}` : " · Not yet approved"}</div>
      </div>

      <div className="no-print grid gap-4 lg:grid-cols-3 mt-4">
        <div className="lg:col-span-2 space-y-4">
          {rec && (
            <section className="card text-sm">
              <h2 className="h2 mb-1">Recommendation used when prepared</h2>
              <p>{rec.message}</p>
              {rec.hours && <p className="muted">Suggested range {fmtHours(rec.hours.low)} – {fmtHours(rec.hours.high)} (mid {fmtHours(rec.hours.mid)}); this estimate: {fmtHours(e.totalHours)}.</p>}
              {rec.comparables?.length > 0 && <p className="text-xs muted">Based on: {rec.comparables.map((c) => c.name).join(", ")}</p>}
              {rec.assumptions?.length > 0 && <ul className="text-xs muted list-disc pl-4 mt-1">{rec.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>}
            </section>
          )}
          {e.notes && <section className="card text-sm"><h2 className="h2 mb-1">Internal notes</h2><div className="whitespace-pre-wrap">{e.notes}</div></section>}
          {e.decisionNote && <section className="card text-sm"><h2 className="h2 mb-1">Decision note</h2><div className="whitespace-pre-wrap">{e.decisionNote}</div></section>}
          <section className="card text-sm">
            <h2 className="h2 mb-2">All revisions for this project</h2>
            <table className="table"><thead><tr><th>Rev</th><th>Scope</th><th>Status</th><th>Hours</th><th>Fee</th><th>Date</th></tr></thead>
              <tbody>{others.map((o) => <tr key={o.id} className={o.id === e.id ? "font-medium" : ""}><td><Link className="link" href={`/estimates/${o.id}`}>{o.revision}</Link></td><td>{o.scopeKind}</td><td><StatusBadge status={o.status} /></td><td>{fmtHours(o.totalHours)}</td><td>{fmtMoney(o.totalFee)}</td><td>{fmtDate(o.createdAt)}</td></tr>)}</tbody>
            </table>
            <p className="text-xs muted mt-2">Original estimates are never overwritten; revisions sit alongside them for comparison.</p>
          </section>
        </div>
        <HistoryList items={history} title="Approval history" />
      </div>
    </div>
  );
}
