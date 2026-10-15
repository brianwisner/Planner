"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Dialog } from "@/components/ui/Dialog";

export function EstimateActions({ id, status, isOwner }: { id: number; status: string; isOwner: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [decide, setDecide] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setErr(null);
    try {
      await fn();
      setDecide(null);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const editable = status === "draft" || status === "submitted" || status === "rejected";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {err && <span className="text-sm text-danger">{err}</span>}
      <button className="btn" onClick={() => window.print()}>Print / PDF</button>
      {editable && <Link href={`/estimates/${id}/edit`} className="btn">Edit</Link>}
      {(status === "draft" || status === "rejected") && <button className="btn btn-primary" disabled={!!busy} onClick={() => act("submit", () => api(`/api/estimates/${id}/submit`, { method: "POST" }))}>Submit for approval</button>}
      {status === "submitted" && !isOwner && <span className="text-sm muted">Waiting for Brian to approve</span>}
      {(status === "submitted" || status === "draft") && isOwner && (
        <>
          <button className="btn btn-primary" disabled={!!busy} onClick={() => setDecide("approve")}>Approve</button>
          <button className="btn btn-danger" disabled={!!busy} onClick={() => setDecide("reject")}>Return for changes</button>
        </>
      )}
      {(status === "approved" || status === "superseded") && <Link href={`/estimates/new?revise=${id}`} className="btn">New revision</Link>}
      {status === "approved" && <Link href={`/estimates/new?projectId=&scope=added&revise=${id}`} className="hidden" />}
      {status === "draft" && <button className="link text-sm" disabled={!!busy} onClick={() => { if (confirm("Delete this draft?")) act("delete", async () => { await api(`/api/estimates/${id}`, { method: "DELETE" }); router.push("/estimates"); }); }}>Delete draft</button>}
      <Dialog open={!!decide} onClose={() => setDecide(null)} title={decide === "approve" ? "Approve estimate" : "Return for changes"}>
        <p className="text-sm mb-2">{decide === "approve" ? "Approving freezes this estimate and updates the project's estimated hours and fee. Earlier approved estimates of the same scope are marked superseded but kept." : "The estimate goes back to draft so it can be revised."}</p>
        <textarea className="textarea" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex justify-end gap-2 mt-3">
          <button className="btn" onClick={() => setDecide(null)}>Cancel</button>
          <button className={`btn ${decide === "approve" ? "btn-primary" : "btn-danger"}`} disabled={!!busy} onClick={() => act(decide!, () => api(`/api/estimates/${id}/${decide}`, { method: "POST", json: { note: note || null } }))}>{decide === "approve" ? "Approve" : "Return"}</button>
        </div>
      </Dialog>
    </div>
  );
}
