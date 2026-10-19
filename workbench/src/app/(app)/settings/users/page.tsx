import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listUsers } from "@/lib/services/users";
import { PageHeader } from "@/components/ui/PageHeader";
import { UsersEditor } from "@/components/settings/UsersEditor";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requireUser();
  const users = await listUsers();
  return (
    <div>
      <PageHeader title="Users & password" subtitle="Two roles: Owner (Brian) can approve estimates and change the approved schedule. Staff (Erika) manages records, logs time, and prepares estimates and proposals." back={<Link href="/settings" className="link">← Settings</Link>} />
      <UsersEditor users={users} me={{ id: me.id, role: me.role }} />
    </div>
  );
}
