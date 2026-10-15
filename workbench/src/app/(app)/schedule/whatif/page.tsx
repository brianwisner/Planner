import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getOwnerId } from "@/lib/services/users";
import { listProjects } from "@/lib/services/projects";
import { PageHeader } from "@/components/ui/PageHeader";
import { WhatIf } from "@/components/schedule/WhatIf";

export const metadata = { title: "What-if" };

export default async function WhatIfPage() {
  const user = await requireUser();
  const ownerId = (await getOwnerId()) ?? user.id;
  const projects = await listProjects({ status: ["inquiry", "proposed", "accepted", "in_progress", "on_hold"] });
  return (
    <div>
      <PageHeader title="What-if scenarios" subtitle="Explore changes without touching the approved schedule. Nothing here is applied until you turn a scenario into a proposal and Brian accepts it." back={<Link href="/schedule" className="link">← Schedule</Link>} />
      <WhatIf userId={ownerId} projects={projects.map((p) => ({ id: p.id, name: p.name, status: p.status, priority: p.priority, remaining: p.remaining, clientDueDate: p.clientDueDate, committed: p.committed, tentativeReserve: p.tentativeReserve }))} />
    </div>
  );
}
