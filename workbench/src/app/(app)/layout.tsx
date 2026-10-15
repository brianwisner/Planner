import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { AppShell } from "@/components/shell/AppShell";
import { AutoSync } from "@/components/shell/AutoSync";
import { getAccount, hasScope, SCOPES } from "@/lib/google/client";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const account = await getAccount(user.id);
  const calendarConnected = !!account && account.status !== "disconnected" && hasScope(account, SCOPES.calendar[0]);
  return (
    <AppShell user={{ id: user.id, name: user.name, role: user.role }}>
      <AutoSync enabled={calendarConnected} />
      {children}
    </AppShell>
  );
}
