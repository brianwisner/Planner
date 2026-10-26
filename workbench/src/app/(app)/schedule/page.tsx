import { requireUser } from "@/lib/auth/session";
import { getOwnerId, listUsers } from "@/lib/services/users";
import { ScheduleBoard } from "@/components/schedule/ScheduleBoard";
import { getAccount } from "@/lib/google/client";

export const metadata = { title: "Schedule" };

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ from?: string; user?: string; project?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const ownerId = (await getOwnerId()) ?? user.id;
  const users = await listUsers();
  const scheduleUserId = sp.user ? Number(sp.user) : ownerId;
  const account = await getAccount(scheduleUserId);
  return (
    <ScheduleBoard
      me={{ id: user.id, role: user.role, tz: user.timezone }}
      scheduleUserId={scheduleUserId}
      users={users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }))}
      initialFrom={sp.from}
      highlightProject={sp.project ? Number(sp.project) : undefined}
      writebackEnabled={!!account?.writebackCalendarId}
    />
  );
}
