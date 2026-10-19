import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listProjects } from "@/lib/services/projects";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/Notice";
import { PriorityBadge, StatusBadge, Pill } from "@/components/ui/Badges";
import { fmtDateShort, fmtHours } from "@/lib/format";

export const metadata = { title: "Projects" };
const FILTERS: Record<string, string[] | undefined> = {
  active: ["accepted", "in_progress"],
  pipeline: ["inquiry", "proposed"],
  hold: ["on_hold"],
  done: ["completed", "declined"],
  all: undefined,
};

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  await requireUser();
  const { view = "active", q } = await searchParams;
  const projects = await listProjects({ status: FILTERS[view] ?? FILTERS.active, q });
  const tabs = [["active", "Active"], ["pipeline", "Pipeline"], ["hold", "On hold"], ["done", "Completed"], ["all", "All"]];
  return (
    <div>
      <PageHeader title="Projects" actions={<Link href="/projects/new" className="btn btn-primary">New project</Link>} />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map(([k, label]) => (
            <Link key={k} href={`/projects?view=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`btn btn-sm ${view === k ? "bg-accent-soft text-accent border-accent/30" : ""}`}>{label}</Link>
          ))}
        </div>
        <form className="flex gap-2 ml-auto" action="/projects">
          <input type="hidden" name="view" value={view} />
          <input name="q" defaultValue={q} placeholder="Search" className="input min-h-[36px] py-1 w-40 sm:w-56" />
        </form>
      </div>
      {projects.length === 0 ? (
        <EmptyState title={view === "active" ? "No active projects." : "Nothing here."} action={<Link href="/projects/new" className="btn btn-primary">Create a project</Link>}>
          {view === "active" ? "Accepted and in-progress projects make up your committed workload. Inquiries and proposals live under Pipeline until the client accepts." : "Try another filter."}
        </EmptyState>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="table">
            <thead>
              <tr><th>Project</th><th>Status</th><th className="hidden sm:table-cell">Priority</th><th className="hidden md:table-cell">Client due</th><th className="hidden lg:table-cell">Target</th><th>Remaining</th><th className="hidden md:table-cell">Est / Actual</th><th className="hidden lg:table-cell">Flags</th></tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/projects/${p.id}`} className="link font-medium">{p.name}</Link>
                    <div className="text-xs muted">{p.clientName}{p.projectTypeName ? ` · ${p.projectTypeName}` : ""}</div>
                  </td>
                  <td><StatusBadge status={p.status} />{p.tentativeReserve && !p.committed && <div className="text-[11px] muted">tentative</div>}</td>
                  <td className="hidden sm:table-cell"><PriorityBadge priority={p.priority} /></td>
                  <td className="hidden md:table-cell">{fmtDateShort(p.clientDueDate)}</td>
                  <td className="hidden lg:table-cell">{fmtDateShort(p.targetCompletion)}</td>
                  <td>{fmtHours(p.remaining)}</td>
                  <td className="hidden md:table-cell">{fmtHours(p.estimatedHours)} / {fmtHours(p.actualHours)}</td>
                  <td className="hidden lg:table-cell space-x-1">
                    {p.openBlockers > 0 && <Pill tone="danger">{p.openBlockers} blocker</Pill>}
                    {p.openWaiting > 0 && <Pill tone="warn">{p.openWaiting} waiting</Pill>}
                    {p.pendingEstimates > 0 && <Pill tone="info">estimate pending</Pill>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
