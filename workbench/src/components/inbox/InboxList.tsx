"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { fmtDateTime } from "@/lib/format";
import { Notice } from "@/components/ui/Notice";
import { Dialog } from "@/components/ui/Dialog";
import { Pill } from "@/components/ui/Badges";

type Msg = { id: number; fromAddress: string | null; fromName: string | null; subject: string | null; snippet: string | null; receivedAt: string | null; linkUrl: string | null; suggestedClientId: number | null; suggestedClientName: string | null; suggestedProjectId: number | null; suggestedProjectName: string | null; matchReason: string | null; relevanceScore: number; status: string };
type C = { id: number; name: string };
type P = { id: number; name: string; clientId: number };

export function InboxList({ clients, projects, lastScan, lastError }: { clients: C[]; projects: P[]; lastScan: string | null; lastError: string | null }) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[] | null>(null);
  const [status, setStatus] = useState<"new" | "linked" | "dismissed" | "all">("new");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState<Msg | null>(null);
  const [cid, setCid] = useState<string>("");
  const [pid, setPid] = useState<string>("");
  const [draft, setDraft] = useState<{ msg: Msg; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ messages: Msg[] }>(`/api/inbox?status=${status}`);
      setMessages(r.messages);
    } catch (e) { setError((e as Error).message); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  async function scan() {
    setBusy("scan");
    setError(null);
    try {
      const r = await api<{ scanned: number; stored: number }>("/api/google/gmail/scan", { method: "POST" });
      await load();
      router.refresh();
      if (r.stored === 0) setError(`Scanned ${r.scanned} recent messages; nothing new since last time.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function dismiss(m: Msg) {
    await api(`/api/inbox/${m.id}/dismiss`, { method: "POST" });
    load();
  }
  function openLink(m: Msg) {
    setLinking(m);
    setCid(m.suggestedClientId ? String(m.suggestedClientId) : "");
    setPid(m.suggestedProjectId ? String(m.suggestedProjectId) : "");
  }
  async function link() {
    if (!linking) return;
    setBusy("link");
    try {
      await api(`/api/inbox/${linking.id}/link`, { method: "POST", json: { clientId: cid ? Number(cid) : null, projectId: pid ? Number(pid) : null } });
      setLinking(null);
      load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function openDraft(m: Msg) {
    setBusy("body");
    try {
      const r = await api<{ text: string }>(`/api/inbox/${m.id}/body`);
      setDraft({ msg: m, text: r.text });
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  const q = (o: Record<string, string | undefined>) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" onClick={scan} disabled={!!busy}>{busy === "scan" ? "Scanning…" : "Scan recent mail"}</button>
        <select className="select w-auto min-h-[36px] py-1" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="new">New suggestions</option><option value="linked">Linked</option><option value="dismissed">Dismissed</option><option value="all">All</option>
        </select>
        <span className="text-xs muted">{lastScan ? `Last scan ${fmtDateTime(lastScan)}` : "Not scanned yet"}</span>
      </div>
      {lastError && <Notice kind="danger">Last Gmail error: {lastError}</Notice>}
      {error && <Notice kind="info">{error}</Notice>}
      {messages === null ? <div className="card text-sm muted">Loading…</div> : messages.length === 0 ? (
        <div className="card text-center py-8"><div className="font-medium">Nothing here.</div><div className="text-sm muted">Click “Scan recent mail” to pull the last two weeks of inbox messages (read-only).</div></div>
      ) : (
        <ul className="space-y-2">
          {messages.map((m) => (
            <li key={m.id} className="card">
              <div className="flex flex-wrap items-start gap-2">
                <div className="flex-1 min-w-[200px]">
                  <div className="font-medium break-words">{m.subject || "(no subject)"}</div>
                  <div className="text-xs muted">{m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress} · {fmtDateTime(m.receivedAt)}</div>
                  <div className="text-sm mt-1 break-words">{m.snippet}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                    {m.suggestedClientName ? <Pill tone="accent">Suggested: {m.suggestedClientName}{m.suggestedProjectName ? ` → ${m.suggestedProjectName}` : ""}</Pill> : m.relevanceScore > 0 ? <Pill tone="info">Possibly project-related</Pill> : <Pill>No match</Pill>}
                    {m.matchReason && <span className="muted">{m.matchReason}</span>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {m.linkUrl && <a className="btn btn-sm" href={m.linkUrl} target="_blank" rel="noreferrer">Open in Gmail ↗</a>}
                  {m.status === "new" && (
                    <>
                      <button className="btn btn-sm btn-primary" onClick={() => openLink(m)}>Link…</button>
                      <button className="btn btn-sm" onClick={() => openDraft(m)} disabled={busy === "body"}>Create from…</button>
                      <button className="btn btn-sm" onClick={() => dismiss(m)}>Dismiss</button>
                    </>
                  )}
                  {m.status !== "new" && <Pill>{m.status}</Pill>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!linking} onClose={() => setLinking(null)} title="Link message">
        <p className="text-sm muted mb-3">A note with the sender, subject, and a link back to Gmail is added to the record you choose.</p>
        <label className="block mb-2"><span className="label">Client</span>
          <select className="select" value={cid} onChange={(e) => { setCid(e.target.value); setPid(""); }}><option value="">—</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="block mb-3"><span className="label">Project (optional)</span>
          <select className="select" value={pid} onChange={(e) => setPid(e.target.value)}><option value="">—</option>{projects.filter((p) => !cid || p.clientId === Number(cid)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <div className="flex justify-end gap-2"><button className="btn" onClick={() => setLinking(null)}>Cancel</button><button className="btn btn-primary" disabled={busy === "link" || (!cid && !pid)} onClick={link}>Link</button></div>
      </Dialog>

      <Dialog open={!!draft} onClose={() => setDraft(null)} title="Create a record from this message" wide>
        {draft && (
          <div className="space-y-3 text-sm">
            <p className="muted">Review the message, then choose what to create. A form opens prefilled from the sender and subject; nothing is saved until you submit it.</p>
            <div className="rounded-lg bg-surface-2 p-3 max-h-64 overflow-y-auto whitespace-pre-wrap text-xs font-mono">{draft.text || draft.msg.snippet}</div>
            <div className="flex flex-wrap gap-2">
              <Link className="btn btn-primary" href={`/clients/new?${q({ name: draft.msg.fromName ?? undefined, email: draft.msg.fromAddress ?? undefined })}`}>New client</Link>
              <Link className="btn" href={`/projects/new?${q({ clientId: draft.msg.suggestedClientId ? String(draft.msg.suggestedClientId) : undefined, name: draft.msg.subject ?? undefined, scope: (draft.text || draft.msg.snippet || "").slice(0, 1500) })}`}>New project</Link>
              {draft.msg.suggestedProjectId && <Link className="btn" href={`/projects/${draft.msg.suggestedProjectId}`}>Add task on {draft.msg.suggestedProjectName}</Link>}
            </div>
            <p className="text-xs muted">Email content is treated as plain text. Instructions inside a message never change anything in Workbench.</p>
          </div>
        )}
      </Dialog>
    </div>
  );
}
