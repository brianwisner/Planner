import Link from "next/link";
import { asc } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { billingRates } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/PageHeader";
import { EstimateEditor } from "@/components/estimates/EstimateEditor";
import { getEstimateFull } from "@/lib/services/estimates";

export const metadata = { title: "New estimate" };

export default async function NewEstimatePage({ searchParams }: { searchParams: Promise<{ projectId?: string; revise?: string; scope?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const rates = await db.select().from(billingRates).orderBy(asc(billingRates.id));
  let initial = { projectId: sp.projectId ? Number(sp.projectId) : null, title: "", scopeKind: (sp.scope === "added" ? "added" : "original") as "original" | "added", feeType: "fixed" as "fixed" | "hourly", hourlyRate: null as number | null, lines: [] as { phase: string; description: string; hours: number; rate: number | null }[], assumptions: "", exclusions: "", notes: "", fixedTotal: null as number | null, supersedesId: null as number | null };
  if (sp.revise) {
    const prev = await getEstimateFull(Number(sp.revise));
    if (prev) {
      initial = { ...initial, projectId: prev.projectId, title: prev.title ?? "", scopeKind: prev.scopeKind, feeType: prev.feeType, hourlyRate: prev.hourlyRate ? Number(prev.hourlyRate) : null, lines: prev.lines.map((l) => ({ phase: l.phase ?? "", description: l.description, hours: Number(l.hours), rate: l.rate != null ? Number(l.rate) : null })), assumptions: prev.assumptions ?? "", exclusions: prev.exclusions ?? "", notes: prev.notes ?? "", fixedTotal: prev.feeType === "fixed" ? Number(prev.totalFee) : null, supersedesId: prev.id };
    }
  }
  return (
    <div>
      <PageHeader title={sp.revise ? "New revision" : "New estimate"} back={<Link href="/estimates" className="link">← Estimates</Link>} />
      <EstimateEditor initial={initial} rates={rates.map((r) => ({ ...r }))} />
    </div>
  );
}
