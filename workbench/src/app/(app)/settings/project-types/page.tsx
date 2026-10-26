import Link from "next/link";
import { asc } from "drizzle-orm";
import { requireOwner } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { projectTypes } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProjectTypesEditor } from "@/components/settings/ProjectTypesEditor";

export const metadata = { title: "Project types" };

export default async function ProjectTypesPage() {
  await requireOwner();
  const rows = await db.select().from(projectTypes).orderBy(asc(projectTypes.sortOrder), asc(projectTypes.name));
  return (
    <div>
      <PageHeader title="Project types & templates" subtitle="Each type is a template: new projects of that type start with its scope, task list, hours, and fee." back={<Link href="/settings" className="link">← Settings</Link>} />
      <ProjectTypesEditor types={rows} />
    </div>
  );
}
