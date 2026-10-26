"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Section } from "@/components/ui/Form";
import { Notice } from "@/components/ui/Notice";

export function DemoLoader() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function load() {
    if (!confirm("Load sample data? This adds clearly-labeled DEMO clients and projects. Only available while APP_ENV=demo.")) return;
    setBusy(true);
    try { const r = await api<{ message: string }>("/api/demo", { method: "POST" }); setMsg(r.message); router.refresh(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  async function clear() {
    if (!confirm("Remove all DEMO-labeled records?")) return;
    setBusy(true);
    try { const r = await api<{ message: string }>("/api/demo", { method: "DELETE" }); setMsg(r.message); router.refresh(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Section title="Demo data (demo environment only)">
      <Notice kind="warn">This server runs with APP_ENV=demo. Sample records are prefixed “DEMO –” so they are never confused with real work. Production should not set APP_ENV=demo.</Notice>
      <div className="flex gap-2 mt-3"><button className="btn" onClick={load} disabled={busy}>Load sample data</button><button className="btn btn-danger" onClick={clear} disabled={busy}>Remove sample data</button></div>
      {msg && <p className="text-sm mt-2">{msg}</p>}
    </Section>
  );
}
