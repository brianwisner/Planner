import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { billingRates } from "@/lib/db/schema";
import { getEstimateFull } from "@/lib/services/estimates";
import { PageHeader } from "@/components/ui/PageHeader";
import { EstimateEditor } from "@/components/estimates/EstimateEditor";

export default async function EditEstimatePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const e = await getEstimateFull(Number(id));
  if (!e) notFound();
  if (e.status === "approved" || e.status === "superseded") redirect(`/estimates/${e.id}`);
  const rates = await db.select().from(billingRates).orderBy(asc(billingRates.id));
  return (
    <div>
      <PageHeader title={`Edit estimate rev ${e.revision}`} subtitle={e.projectName} back={<Link href={`/estimates/${e.id}`} className="link">← Back</Link>} />
      <EstimateEditor rates={rates} initial={{ id: e.id, version: e.version, projectId: e.projectId, title: e.title ?? "", scopeKind: e.scopeKind, feeType: e.feeType, hourlyRate: e.hourlyRate ? Number(e.hourlyRate) : null, lines: e.lines.map((l) => ({ phase: l.phase ?? "", description: l.description, hours: Number(l.hours), rate: l.rate != null ? Number(l.rate) : null })), assumptions: e.assumptions ?? "", exclusions: e.exclusions ?? "", notes: e.notes ?? "", fixedTotal: e.feeType === "fixed" ? Number(e.totalFee) : null }} />
    </div>
  );
}
