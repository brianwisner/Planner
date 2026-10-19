import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listEstimates } from "@/lib/services/estimates";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/Badges";
import { fmtDate, fmtHours, fmtMoney } from "@/lib/format";

export const metadata = { title: "Estimates" };

export default async function EstimatesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireUser();
  const { status = "all" } = await searchParams;
  const rows = await listEstimates({ status });
  const tabs = [["all", "All"], ["draft", "Drafts"], ["submitted", "Awaiting approval"], ["approved", "Approved"]];
  return (
    <div>
      <PageHeader title="Estimates" subtitle="Prepare, submit, and approve. Approved estimates are frozen; make a revision to change them." actions={<Link href="/estimates/new" className="btn btn-primary">New estimate</Link>} />
      <div className="flex gap-1 mb-4 overflow-x-auto">{tabs.map(([k, l]) => <Link key={k} href={`/estimates?status=${k}`} className={`btn btn-sm ${status === k ? "bg-accent-soft text-accent border-accent/30" : ""}`}>{l}</Link>)}</div>
      {rows.length === 0 ? <EmptyState title="No estimates here." action={<Link href="/estimates/new" className="btn btn-primary">Prepare an estimate</Link>}>Pick a project, choose hourly or fixed fee, and build the phase breakdown. Templates and similar completed projects help you fill in hours.</EmptyState> : (
        <div className="card p-0 overflow-x-auto">
          <table className="table">
            <thead><tr><th>Project</th><th>Rev</th><th>Status</th><th>Hours</th><th>Fee</th><th className="hidden md:table-cell">Prepared by</th><th className="hidden md:table-cell">Date</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td><Link className="link font-medium" href={`/estimates/${e.id}`}>{e.projectName}</Link><div className="text-xs muted">{e.clientName}{e.scopeKind === "added" ? " · added scope" : ""}</div></td>
                  <td>{e.revision}</td><td><StatusBadge status={e.status} /></td><td>{fmtHours(e.totalHours)}</td><td>{fmtMoney(e.totalFee)}</td>
                  <td className="hidden md:table-cell">{e.preparedByName}</td><td className="hidden md:table-cell">{fmtDate(e.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
