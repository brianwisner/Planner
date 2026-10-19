"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { OfflineBanner } from "@/components/ui/SaveState";
import { TimerBar } from "@/components/time/TimerBar";
import { api } from "@/lib/client/api";

type NavItem = { href: string; label: string; icon: string; ownerOnly?: boolean };

const NAV: NavItem[] = [
  { href: "/today", label: "Today", icon: "☀" },
  { href: "/schedule", label: "Schedule", icon: "▦" },
  { href: "/projects", label: "Projects", icon: "▤" },
  { href: "/clients", label: "Clients", icon: "☺" },
  { href: "/estimates", label: "Estimates", icon: "≡" },
  { href: "/time", label: "Time", icon: "◷" },
  { href: "/inbox", label: "Inbox", icon: "✉" },
  { href: "/reports", label: "Reports", icon: "▥" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];
const MOBILE_PRIMARY = ["/today", "/schedule", "/projects", "/time"];

export function AppShell({
  user,
  children,
}: {
  user: { id: number; name: string; role: "owner" | "staff" };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="min-h-dvh flex flex-col md:flex-row">
      {/* Desktop / tablet sidebar */}
      <aside className="hidden md:flex md:flex-col w-56 shrink-0 border-r border-line bg-surface sticky top-0 h-dvh">
        <div className="px-4 py-4 border-b border-line">
          <div className="text-[11px] uppercase tracking-wide muted">Wisner Engineering</div>
          <div className="font-semibold">Workbench</div>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm ${isActive(n.href) ? "bg-accent-soft text-accent font-medium" : "text-ink hover:bg-surface-2"}`}
            >
              <span className="w-5 text-center opacity-70" aria-hidden>{n.icon}</span>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-line text-sm">
          <div className="font-medium truncate">{user.name}</div>
          <div className="text-xs muted">{user.role === "owner" ? "Owner" : "Staff"}</div>
          <button onClick={signOut} className="link text-xs mt-1">Sign out</button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-line bg-surface sticky top-0 z-20" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
          <div className="font-semibold">Workbench</div>
          <div className="text-xs muted">{user.name}</div>
        </header>
        <OfflineBanner />
        <TimerBar />
        <main className="flex-1 px-4 py-4 md:px-8 md:py-6 pb-24 md:pb-8 max-w-6xl w-full mx-auto">{children}</main>

        {/* Mobile bottom tabs */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 bg-surface border-t border-line grid grid-cols-5 z-20" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          {NAV.filter((n) => MOBILE_PRIMARY.includes(n.href)).map((n) => (
            <Link key={n.href} href={n.href} className={`flex flex-col items-center justify-center py-2 text-[11px] min-h-[56px] ${isActive(n.href) ? "text-accent font-medium" : "muted"}`}>
              <span className="text-lg leading-none mb-1" aria-hidden>{n.icon}</span>
              {n.label}
            </Link>
          ))}
          <Link href="/more" className={`flex flex-col items-center justify-center py-2 text-[11px] min-h-[56px] ${["/more", "/clients", "/estimates", "/inbox", "/reports", "/settings"].some(isActive) ? "text-accent font-medium" : "muted"}`}>
            <span className="text-lg leading-none mb-1" aria-hidden>⋯</span>
            More
          </Link>
        </nav>
      </div>
    </div>
  );
}

export function MoreMenu({ role }: { role: string }) {
  const router = useRouter();
  async function signOut() {
    await api("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }
  return (
    <div className="space-y-2">
      {NAV.filter((n) => !MOBILE_PRIMARY.includes(n.href)).map((n) => (
        <Link key={n.href} href={n.href} className="card flex items-center gap-3 py-3">
          <span className="w-6 text-center opacity-70" aria-hidden>{n.icon}</span>
          <span className="font-medium">{n.label}</span>
        </Link>
      ))}
      <button onClick={signOut} className="btn w-full mt-4">Sign out ({role})</button>
    </div>
  );
}
