"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { fmtMinutes } from "@/lib/format";

export type RunningTimer = {
  id: number;
  projectId: number;
  projectName: string;
  clientName: string;
  taskName: string | null;
  startedAt: string;
};

/** Elapsed time is computed from the server start timestamp, so it stays correct across tabs, devices and restarts. */
export function useRunningTimer() {
  const [timer, setTimer] = useState<RunningTimer | null | undefined>(undefined);
  const [offset, setOffset] = useState(0); // server - client clock skew, ms
  const refresh = useCallback(async () => {
    try {
      const r = await api<{ timer: RunningTimer | null; serverTime: string }>("/api/timers/current");
      setTimer(r.timer);
      setOffset(new Date(r.serverTime).getTime() - Date.now());
    } catch {
      /* keep last known state when offline */
    }
  }, []);
  useEffect(() => {
    refresh();
    const onVis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", refresh);
    window.addEventListener("timer-changed", refresh);
    const iv = setInterval(refresh, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("timer-changed", refresh);
      clearInterval(iv);
    };
  }, [refresh]);
  return { timer, refresh, offset };
}

export function notifyTimerChanged() {
  window.dispatchEvent(new Event("timer-changed"));
}

export function elapsedMinutes(startedAt: string, offset = 0) {
  return Math.max(0, Math.floor((Date.now() + offset - new Date(startedAt).getTime()) / 60000));
}

export function TimerBar() {
  const { timer, refresh, offset } = useRunningTimer();
  const [, tick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const iv = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(iv);
  }, []);
  if (!timer) return null;
  const mins = elapsedMinutes(timer.startedAt, offset);
  async function stop() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/timers/stop", { method: "POST" });
      notifyTimerChanged();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="bg-accent text-white px-4 py-2 flex items-center gap-3 text-sm sticky top-0 md:top-0 z-10">
      <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse" aria-hidden />
      <Link href={`/projects/${timer.projectId}`} className="truncate font-medium hover:underline">
        {timer.projectName}
        {timer.taskName ? ` · ${timer.taskName}` : ""}
      </Link>
      <span className="font-mono tabular-nums ml-auto">{fmtMinutes(mins)}</span>
      <button onClick={stop} disabled={busy} className="btn btn-sm bg-white text-accent border-white">
        {busy ? "Stopping…" : "Stop"}
      </button>
      {error && <span className="text-xs">{error}</span>}
    </div>
  );
}
