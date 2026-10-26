import Link from "next/link";
import { notFound } from "next/navigation";
import { asc } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getProjectFull } from "@/lib/services/projects";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProjectDetail } from "@/components/projects/ProjectDetail";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const project = await getProjectFull(Number(id));
  if (!project) notFound();
  const all = await db.select({ id: projects.id, name: projects.name }).from(projects).orderBy(asc(projects.name));
  return (
    <div>
      <PageHeader title={project.name} subtitle={<span><Link className="link" href={`/clients/${project.clientId}`}>{project.clientName}</Link>{project.address ? ` · ${project.address}` : ""}</span>} back={<Link href="/projects" className="link">← Projects</Link>} />
      <ProjectDetail project={project} isOwner={user.role === "owner"} allProjects={all} />
    </div>
  );
}
