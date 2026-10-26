"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";

export function UndoButton({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button className="btn btn-sm" disabled={busy} onClick={async () => { if (!confirm("Undo this accepted proposal? The schedule goes back to how it was before acceptance.")) return; setBusy(true); try { await api(`/api/proposals/${id}/undo`, { method: "POST" }); router.refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }}>Undo</button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </span>
  );
}
