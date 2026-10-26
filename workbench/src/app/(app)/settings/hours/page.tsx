import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getAvailability } from "@/lib/services/schedule";
import { listUsers } from "@/lib/services/users";
import { PageHeader } from "@/components/ui/PageHeader";
import { HoursEditor } from "@/components/settings/HoursEditor";

export const metadata = { title: "Working hours" };

export default async function HoursPage({ searchParams }: { searchParams: Promise<{ user?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const userId = me.role === "owner" && sp.user ? Number(sp.user) : me.id;
  const users = await listUsers();
  const a = await getAvailability(userId);
  return (
    <div>
      <PageHeader title="Working hours & scheduling" subtitle="Capacity = working window − breaks − calendar appointments − buffer." back={<Link href="/settings" className="link">← Settings</Link>} />
      {me.role === "owner" && users.length > 1 && (
        <div className="flex gap-2 mb-4">{users.filter((u) => u.active).map((u) => <Link key={u.id} href={`/settings/hours?user=${u.id}`} className={`btn btn-sm ${u.id === userId ? "bg-accent-soft text-accent" : ""}`}>{u.name}</Link>)}</div>
      )}
      <HoursEditor userId={userId} rules={a.rules} exceptions={a.exceptions} prefs={{ ...a.prefs, minBlockHours: Number(a.prefs.minBlockHours) }} />
    </div>
  );
}
