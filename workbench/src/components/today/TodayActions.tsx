"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { notifyTimerChanged } from "@/components/time/TimerBar";
import { LogTimeDialog } from "@/components/time/LogTimeDialog";
import { Dialog } from "@/components/ui/Dialog";

type P = { id: number; name: string; clientName: string };

export function StartTimerButton({ projectId, label = "▶ Start" }: { projectId: number; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function start() {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/timers/start", { method: "POST", json: { projectId } });
      notifyTimerChanged();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="flex items-center gap-2">
      <button className="btn btn-sm btn-primary" onClick={start} disabled={busy}>{label}</button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </span>
  );
}

export function TodayActions({ projects }: { projects: P[] }) {
  const router = useRouter();
  const [logOpen, setLogOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  return (
    <div className="flex gap-2 no-print">
      <button className="btn btn-primary" onClick={() => setPickOpen(true)}>▶ Start timer</button>
      <button className="btn" onClick={() => setLogOpen(true)}>Log time</button>
      <LogTimeDialog open={logOpen} onClose={() => setLogOpen(false)} onSaved={() => router.refresh()} />
      <Dialog open={pickOpen} onClose={() => setPickOpen(false)} title="Start timer on…">
        {projects.length === 0 ? <p className="text-sm muted">No committed projects. Accept a project first.</p> : (
          <ul className="divide-y divide-line">
            {projects.map((p) => (
              <li key={p.id} className="py-2 flex items-center justify-between gap-2">
                <div className="min-w-0"><div className="font-medium truncate">{p.name}</div><div className="text-xs muted">{p.clientName}</div></div>
                <StartTimerButton projectId={p.id} />
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  );
}
