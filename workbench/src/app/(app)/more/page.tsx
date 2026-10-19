import { requireUser } from "@/lib/auth/session";
import { MoreMenu } from "@/components/shell/AppShell";

export default async function MorePage() {
  const user = await requireUser();
  return (
    <div>
      <h1 className="h1 mb-4">More</h1>
      <MoreMenu role={user.role} />
    </div>
  );
}
