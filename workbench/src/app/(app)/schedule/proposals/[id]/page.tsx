import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { projects, scheduleProposals, users } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProposalReview } from "@/components/schedule/ProposalReview";
import { getCapacity } from "@/lib/services/schedule";

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [row] = await db.select({ p: scheduleProposals, createdByName: users.name }).from(scheduleProposals).leftJoin(users, eq(users.id, scheduleProposals.createdBy)).where(eq(scheduleProposals.id, Number(id)));
  if (!row) notFound();
  const names = Object.fromEntries((await db.select({ id: projects.id, name: projects.name }).from(projects)).map((p) => [p.id, p.name]));
  const { days } = await getCapacity(row.p.userId, row.p.summary.horizonStart, row.p.summary.horizonEnd);
  return (
    <div>
      <PageHeader title={row.p.title} subtitle={`Proposed by ${row.createdByName ?? "system"} · ${row.p.summary.horizonStart} to ${row.p.summary.horizonEnd}`} back={<Link href="/schedule/proposals" className="link">← Proposals</Link>} />
      <ProposalReview proposal={{ ...row.p, createdAt: row.p.createdAt.toISOString(), decidedAt: row.p.decidedAt?.toISOString() ?? null }} projectNames={names} days={days.map((d) => ({ date: d.date, availableHours: d.availableHours, off: d.off }))} isOwner={user.role === "owner"} />
    </div>
  );
}
