"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Syncs selected Google calendars when the app is opened, at most every 15 minutes per browser. Failures are shown in Settings → Google. */
export function AutoSync({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    let last = 0;
    try { last = Number(localStorage.getItem("wb_cal_sync") ?? 0); } catch {}
    if (Date.now() - last < 15 * 60_000) return;
    try { localStorage.setItem("wb_cal_sync", String(Date.now())); } catch {}
    fetch("/api/google/calendars/sync", { method: "POST", credentials: "same-origin" }).then((r) => { if (r.ok) router.refresh(); }).catch(() => {});
  }, [enabled, router]);
  return null;
}
