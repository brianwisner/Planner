"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { useSave } from "@/lib/client/useSave";
import { SaveIndicator } from "@/components/ui/SaveState";
import { Section, Field, Row } from "@/components/ui/Form";
import { fmtDateShort } from "@/lib/format";

type Rule = { weekday: number; startMinute: number; endMinute: number; breakMinutes: number };
type Exc = { id: number; date: string; kind: "off" | "custom"; startMinute: number | null; endMinute: number | null; breakMinutes: number | null; note: string | null };
type Prefs = { bufferPercent: number; maxConcurrentProjects: number; minBlockHours: number; horizonDays: number; timezone: string };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const toT = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toM = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };

export function HoursEditor({ userId, rules, exceptions, prefs }: { userId: number; rules: Rule[]; exceptions: Exc[]; prefs: Prefs }) {
  const router = useRouter();
  const [week, setWeek] = useState<Record<number, { on: boolean; start: string; end: string; brk: number }>>(() => {
    const o: Record<number, { on: boolean; start: string; end: string; brk: number }> = {};
    for (let d = 1; d <= 7; d++) {
      const r = rules.find((x) => x.weekday === d);
      o[d] = r ? { on: true, start: toT(r.startMinute), end: toT(r.endMinute), brk: r.breakMinutes } : { on: false, start: "08:00", end: "17:00", brk: 60 };
    }
    return o;
  });
  const [p, setP] = useState<Prefs>(prefs);
  const [exc, setExc] = useState({ date: "", kind: "off" as "off" | "custom", start: "09:00", end: "13:00", brk: 0, note: "" });
  const weekSave = useSave();
  const prefSave = useSave();
  const excSave = useSave();
  const hoursPerWeek = Object.values(week).filter((d) => d.on).reduce((s, d) => s + Math.max(0, (toM(d.end) - toM(d.start) - d.brk) / 60), 0);

  async function saveWeek() {
    await weekSave.run(() => api("/api/availability/rules", { method: "PUT", json: { userId, rules: Object.entries(week).filter(([, d]) => d.on).map(([wd, d]) => ({ weekday: Number(wd), startMinute: toM(d.start), endMinute: toM(d.end), breakMinutes: d.brk })) } }));
    router.refresh();
  }
  async function savePrefs() {
    await prefSave.run(() => api("/api/availability/prefs", { method: "PUT", json: { userId, ...p } }));
    router.refresh();
  }
  async function addExc(e: React.FormEvent) {
    e.preventDefault();
    const r = await excSave.run(() => api("/api/availability/exceptions", { method: "POST", json: { userId, date: exc.date, kind: exc.kind, startMinute: exc.kind === "custom" ? toM(exc.start) : null, endMinute: exc.kind === "custom" ? toM(exc.end) : null, breakMinutes: exc.kind === "custom" ? exc.brk : null, note: exc.note || null } }));
    if (r) { setExc({ ...exc, date: "", note: "" }); router.refresh(); }
  }
  async function delExc(id: number) {
    await api(`/api/availability/exceptions/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Weekly working hours" actions={<span className="text-sm muted">{Math.round(hoursPerWeek * 10) / 10} h/week net of breaks</span>}>
        <div className="space-y-2">
          {DAYS.map((label, i) => { const d = i + 1; const w = week[d]; return (
            <div key={d} className="grid grid-cols-12 gap-2 items-center text-sm">
              <label className="col-span-3 flex items-center gap-2"><input type="checkbox" checked={w.on} onChange={(e) => setWeek({ ...week, [d]: { ...w, on: e.target.checked } })} /> {label}</label>
              <input className="input col-span-3 min-h-[36px] py-1" type="time" value={w.start} disabled={!w.on} onChange={(e) => setWeek({ ...week, [d]: { ...w, start: e.target.value } })} />
              <input className="input col-span-3 min-h-[36px] py-1" type="time" value={w.end} disabled={!w.on} onChange={(e) => setWeek({ ...week, [d]: { ...w, end: e.target.value } })} />
              <div className="col-span-3 flex items-center gap-1"><input className="input min-h-[36px] py-1" type="number" min={0} step={15} value={w.brk} disabled={!w.on} onChange={(e) => setWeek({ ...week, [d]: { ...w, brk: Number(e.target.value) } })} aria-label="Break minutes" /><span className="text-xs muted">min break</span></div>
            </div>
          ); })}
        </div>
        <div className="flex items-center gap-3 mt-3"><button className="btn btn-primary" onClick={saveWeek}>Save hours</button><SaveIndicator status={weekSave.status} message={weekSave.message} /></div>
      </Section>

      <Section title="Scheduling preferences">
        <Row>
          <Field label="Buffer (%)" hint="Held back from every day for interruptions and admin."><input className="input" type="number" min={0} max={90} value={p.bufferPercent} onChange={(e) => setP({ ...p, bufferPercent: Number(e.target.value) })} /></Field>
          <Field label="Projects at once" hint="Recommendations keep active projects within this limit."><input className="input" type="number" min={1} max={10} value={p.maxConcurrentProjects} onChange={(e) => setP({ ...p, maxConcurrentProjects: Number(e.target.value) })} /></Field>
          <Field label="Smallest block (hours)"><input className="input" type="number" min={0.25} max={8} step={0.25} value={p.minBlockHours} onChange={(e) => setP({ ...p, minBlockHours: Number(e.target.value) })} /></Field>
          <Field label="Planning horizon (days)"><input className="input" type="number" min={7} max={180} value={p.horizonDays} onChange={(e) => setP({ ...p, horizonDays: Number(e.target.value) })} /></Field>
        </Row>
        <Field label="Time zone" className="mt-3"><input className="input" value={p.timezone} onChange={(e) => setP({ ...p, timezone: e.target.value })} /></Field>
        <div className="flex items-center gap-3 mt-3"><button className="btn btn-primary" onClick={savePrefs}>Save preferences</button><SaveIndicator status={prefSave.status} message={prefSave.message} /></div>
      </Section>

      <Section title="Days off & exceptions">
        <p className="text-sm muted mb-2">Holidays, vacation, half days. Busy all-day calendar events also block a day automatically.</p>
        <form onSubmit={addExc} className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end mb-3">
          <Field label="Date" className="col-span-2 sm:col-span-2"><input className="input" type="date" required value={exc.date} onChange={(e) => setExc({ ...exc, date: e.target.value })} /></Field>
          <Field label="Kind"><select className="select" value={exc.kind} onChange={(e) => setExc({ ...exc, kind: e.target.value as "off" | "custom" })}><option value="off">Day off</option><option value="custom">Custom hours</option></select></Field>
          {exc.kind === "custom" && (<><Field label="Start"><input className="input" type="time" value={exc.start} onChange={(e) => setExc({ ...exc, start: e.target.value })} /></Field><Field label="End"><input className="input" type="time" value={exc.end} onChange={(e) => setExc({ ...exc, end: e.target.value })} /></Field></>)}
          <Field label="Note" className="col-span-2 sm:col-span-2"><input className="input" value={exc.note} onChange={(e) => setExc({ ...exc, note: e.target.value })} placeholder="Vacation" /></Field>
          <button className="btn btn-primary">Add</button>
        </form>
        <SaveIndicator status={excSave.status} message={excSave.message} />
        {exceptions.length === 0 ? <p className="text-sm muted">No exceptions.</p> : (
          <ul className="divide-y divide-line text-sm">{exceptions.map((e) => <li key={e.id} className="py-1.5 flex justify-between"><span>{fmtDateShort(e.date)} · {e.kind === "off" ? "off" : `${toT(e.startMinute ?? 0)}–${toT(e.endMinute ?? 0)}`}{e.note ? ` · ${e.note}` : ""}</span><button className="link text-xs" onClick={() => delExc(e.id)}>Remove</button></li>)}</ul>
        )}
      </Section>
    </div>
  );
}
