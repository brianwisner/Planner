import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Form";
import { DemoLoader } from "@/components/settings/DemoLoader";

export const metadata = { title: "Data & backup" };

export default async function DataPage() {
  const user = await requireUser();
  const demo = process.env.APP_ENV === "demo";
  return (
    <div className="space-y-4">
      <PageHeader title="Data, export & backup" back={<Link href="/settings" className="link">← Settings</Link>} />
      <Section title="Export">
        <p className="text-sm muted mb-3">Core records in common formats. Exports are logged in the activity history.</p>
        <div className="flex flex-wrap gap-2">
          <a className="btn" href="/api/export?what=clients&format=csv">Clients (CSV)</a>
          <a className="btn" href="/api/export?what=projects&format=csv">Projects (CSV)</a>
          <a className="btn" href="/api/export?what=time&format=csv">Time entries (CSV)</a>
          <a className="btn" href="/api/export?what=estimates&format=csv">Estimates (CSV)</a>
          <a className="btn btn-primary" href="/api/export?what=all&format=json">Everything (JSON)</a>
        </div>
      </Section>
      <Section title="Backups">
        <div className="text-sm space-y-2">
          <p>The database is the single source of truth. Two layers of protection are recommended:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li><strong>Hosted database backups</strong> — your Postgres provider (Neon, Railway, Supabase, …) keeps automatic backups or point-in-time restore. Confirm it is turned on in their dashboard.</li>
            <li><strong>Your own copy</strong> — once a month, download “Everything (JSON)” above and keep it with your other business records. For a full restorable copy, run the <code>pg_dump</code> command in docs/DEPLOYMENT.md.</li>
          </ol>
          <p>Restore instructions are in docs/DEPLOYMENT.md under “Backup and restore”.</p>
        </div>
      </Section>
      {demo && user.role === "owner" && <DemoLoader />}
    </div>
  );
}
