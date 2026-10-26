import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { auditLog, users } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/PageHeader";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Activity history" };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  await requireUser();
  const { type } = await searchParams;
  const rows = await db.select({ id: auditLog.id, at: auditLog.at, action: auditLog.action, entityType: auditLog.entityType, entityId: auditLog.entityId, summary: auditLog.summary, userName: users.name }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId)).where(type ? eq(auditLog.entityType, type) : undefined).orderBy(desc(auditLog.at)).limit(300);
  const types = ["", "project", "client", "estimate", "proposal", "schedule", "user", "system"];
  const link = (r: (typeof rows)[number]) => r.entityType === "project" ? `/projects/${r.entityId}` : r.entityType === "client" ? `/clients/${r.entityId}` : r.entityType === "estimate" ? `/estimates/${r.entityId}` : r.entityType === "proposal" ? `/schedule/proposals/${r.entityId}` : null;
  return (
    <div>
      <PageHeader title="Activity history" subtitle="Approvals, schedule changes, and edits to important records." back={<Link href="/settings" className="link">← Settings</Link>} />
      <div className="flex gap-1 mb-3 overflow-x-auto">{types.map((t) => <Link key={t} href={`/settings/history${t ? `?type=${t}` : ""}`} className={`btn btn-sm ${(type ?? "") === t ? "bg-accent-soft text-accent" : ""}`}>{t || "All"}</Link>)}</div>
      <div className="card p-0 overflow-x-auto">
        <table className="table"><thead><tr><th>When</th><th>Who</th><th>What</th><th className="hidden sm:table-cell">Record</th></tr></thead>
          <tbody>{rows.map((r) => { const l = link(r); return <tr key={r.id}><td className="whitespace-nowrap text-xs">{fmtDateTime(r.at)}</td><td>{r.userName ?? "system"}</td><td>{r.summary}</td><td className="hidden sm:table-cell text-xs">{l ? <Link className="link" href={l}>{r.entityType} #{r.entityId}</Link> : `${r.entityType}${r.entityId ? ` #${r.entityId}` : ""}`}</td></tr>; })}</tbody>
        </table>
        {rows.length === 0 && <p className="p-4 text-sm muted">No activity yet.</p>}
      </div>
    </div>
  );
}
