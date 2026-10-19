import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listClients } from "@/lib/services/clients";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/Notice";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  await requireUser();
  const { q, status } = await searchParams;
  const clients = await listClients({ q, status: status ?? "active" });
  return (
    <div>
      <PageHeader title="Clients" subtitle={`${clients.length} ${status === "archived" ? "archived" : "active"}`} actions={<Link href="/clients/new" className="btn btn-primary">New client</Link>} />
      <form className="flex gap-2 mb-4" action="/clients">
        <input name="q" defaultValue={q} placeholder="Search name, company, email" className="input max-w-sm" />
        <select name="status" defaultValue={status ?? "active"} className="select w-auto">
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
        <button className="btn">Search</button>
      </form>
      {clients.length === 0 ? (
        <EmptyState title={q ? "No clients match that search." : "No clients yet."} action={<Link href="/clients/new" className="btn btn-primary">Add your first client</Link>}>
          Clients hold contact details, linked projects, notes, and correspondence. Add one, then create a project under it.
        </EmptyState>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="hidden sm:table-cell">Company</th>
                <th className="hidden md:table-cell">Contact</th>
                <th>Projects</th>
                <th className="hidden md:table-cell">Last contact</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/clients/${c.id}`} className="link font-medium">{c.name}</Link>
                    <div className="text-xs muted sm:hidden">{c.company}</div>
                  </td>
                  <td className="hidden sm:table-cell">{c.company ?? "–"}</td>
                  <td className="hidden md:table-cell text-sm">{[c.email, c.phone].filter(Boolean).join(" · ") || "–"}</td>
                  <td>{c.activeProjects} active / {c.projectCount}</td>
                  <td className="hidden md:table-cell">{fmtDate(c.lastActivity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
