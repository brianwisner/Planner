import { requireUser } from "@/lib/auth/session";
import { TimeSheet } from "@/components/time/TimeSheet";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata = { title: "Time" };

export default async function TimePage({ searchParams }: { searchParams: Promise<{ week?: string; projectId?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  return (
    <div>
      <PageHeader title="Time" subtitle="Timer and manual entries. Timers run on the server, so they keep counting if you close the tab or switch devices." />
      <TimeSheet tz={user.timezone} isOwner={user.role === "owner"} initialWeek={sp.week} projectId={sp.projectId ? Number(sp.projectId) : undefined} />
    </div>
  );
}
