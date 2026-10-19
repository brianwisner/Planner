import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { scheduleProposals, users } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/Badges";
import { fmtDateTime } from "@/lib/format";
import { UndoButton } from "@/components/schedule/ProposalActions";
import { EmptyState } from "@/components/ui/Notice";

export const metadata = { title: "Schedule proposals" };

export default async function ProposalsPage() {
  const user = await requireUser();
  const rows = await db
    .select({ id: scheduleProposals.id, title: scheduleProposals.title, status: scheduleProposals.status, createdAt: scheduleProposals.createdAt, decidedAt: scheduleProposals.decidedAt, createdByName: users.name, summary: scheduleProposals.summary })
    .from(scheduleProposals)
    .leftJoin(users, eq(users.id, scheduleProposals.createdBy))
    .orderBy(desc(scheduleProposals.createdAt))
    .limit(50);
  const lastAccepted = rows.find((r) => r.status === "accepted");
  return (
    <div>
      <PageHeader title="Schedule proposals" subtitle="Recommendations and proposed changes. Only accepted proposals change the approved schedule." back={<Link href="/schedule" className="link">← Schedule</Link>} />
      {rows.length === 0 ? <EmptyState title="No proposals yet.">Click “Recommend schedule” on the Schedule page to generate one.</EmptyState> : (
        <div className="card p-0 overflow-x-auto">
          <table className="table">
            <thead><tr><th>Proposal</th><th>Status</th><th className="hidden sm:table-cell">Changes</th><th className="hidden md:table-cell">Created</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link className="link font-medium" href={`/schedule/proposals/${r.id}`}>{r.title}</Link><div className="text-xs muted">by {r.createdByName}</div></td>
                  <td><StatusBadge status={r.status === "proposed" ? "proposed_schedule" : r.status} /></td>
                  <td className="hidden sm:table-cell">{r.summary.moves.length} moves · {r.summary.forecasts.filter((f) => f.atRisk).length} at risk</td>
                  <td className="hidden md:table-cell">{fmtDateTime(r.createdAt)}</td>
                  <td>{user.role === "owner" && lastAccepted?.id === r.id && <UndoButton id={r.id} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
