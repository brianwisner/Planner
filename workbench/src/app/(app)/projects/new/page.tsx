import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProjectForm } from "@/components/projects/ProjectForm";

export const metadata = { title: "New project" };

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ clientId?: string; name?: string; address?: string; scope?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  return (
    <div className="max-w-3xl">
      <PageHeader title="New project" back={<Link href="/projects" className="link">← Projects</Link>} />
      <div className="card">
        <ProjectForm initial={{ clientId: sp.clientId ? Number(sp.clientId) : null, name: sp.name ?? "", address: sp.address ?? null, scope: sp.scope ?? null }} />
      </div>
    </div>
  );
}
