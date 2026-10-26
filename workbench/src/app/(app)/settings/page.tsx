import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata = { title: "Settings" };

const ITEMS = [
  { href: "/settings/hours", title: "Working hours & scheduling", desc: "Weekly hours, days off, buffer, and how many projects to juggle at once." },
  { href: "/settings/google", title: "Google Calendar & Gmail", desc: "Connect your Google account, choose calendars that affect availability, optional write-back." },
  { href: "/settings/project-types", title: "Project types & templates", desc: "Structural project types with default scope, tasks, hours, and fees.", ownerOnly: true },
  { href: "/settings/rates", title: "Billing rates", desc: "Hourly rates used in estimates.", ownerOnly: true },
  { href: "/settings/users", title: "Users & password", desc: "Brian and Erika's accounts. Change your password." },
  { href: "/settings/data", title: "Data, export & backup", desc: "Download CSV/JSON exports, backup instructions, demo data." },
  { href: "/settings/history", title: "Activity history", desc: "Who changed what, and when." },
];

export default async function SettingsPage() {
  const user = await requireUser();
  return (
    <div>
      <PageHeader title="Settings" />
      <div className="grid gap-3 sm:grid-cols-2">
        {ITEMS.filter((i) => !i.ownerOnly || user.role === "owner").map((i) => (
          <Link key={i.href} href={i.href} className="card hover:bg-surface-2"><div className="font-medium">{i.title}</div><div className="text-sm muted">{i.desc}</div></Link>
        ))}
      </div>
    </div>
  );
}
