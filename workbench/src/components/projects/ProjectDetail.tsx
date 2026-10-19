"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ProjectFull } from "@/lib/services/projects";
import { ProjectForm } from "./ProjectForm";
import { Dialog } from "@/components/ui/Dialog";
import { Section } from "@/components/ui/Form";
import { StatusBadge, PriorityBadge, Pill } from "@/components/ui/Badges";
import { Notice } from "@/components/ui/Notice";
import { api } from "@/lib/client/api";
import { fmtDate, fmtDateShort, fmtHours, fmtMinutes, fmtMoney, num } from "@/lib/format";
import { CorrespondenceList } from "@/components/shared/Correspondence";
import { HistoryList } from "@/components/shared/History";
import { TasksPanel } from "./TasksPanel";
import { ItemsPanel } from "./ItemsPanel";
import { notifyTimerChanged } from "@/components/time/TimerBar";
import { LogTimeDialog } from "@/components/time/LogTimeDialog";

export function ProjectDetail({ project, isOwner, allProjects }: { project: ProjectFull; isOwner: boolean; allProjects: { id: number; name: string }[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [remainingOpen, setRemainingOpen] = useState(false);
  const [remaining, setRemaining] = useState(String(project.remaining));
  const [logOpen, setLogOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [depsOpen, setDepsOpen] = useState(false);
  const [deps, setDeps] = useState<number[]>(project.dependencies.map((d) => d.dependsOnId));

  const est = num(project.estimatedHours);
  const pct = est > 0 ? Math.min(100, Math.round((project.actualHours / est) * 100)) : 0;
  const over = est > 0 && project.actualHours > est;
  const openBlockers = project.items.filter((i) => i.kind === "blocker" && i.status === "open");
  const openWaiting = project.items.filter((i) => i.kind === "waiting" && i.status === "open");
  const scopeChanges = project.items.filter((i) => i.kind === "scope_change");
  const addedHours = scopeChanges.reduce((s, i) => s + num(i.hoursAdded), 0);
  const approved = project.estimates.filter((e) => e.status === "approved");
  const forecast = project.workBlocks.length ? project.workBlocks[project.workBlocks.length - 1].date : null;

  async function startTimer() {
    setErr(null);
    try {
      await api("/api/timers/start", { method: "POST", json: { projectId: project.id } });
      notifyTimerChanged();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function saveRemaining(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`/api/projects/${project.id}`, { method: "PATCH", json: { remainingHours: remaining === "" ? null : Number(remaining), version: project.version } });
      setRemainingOpen(false);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function saveDeps() {
    try {
      await api(`/api/projects/${project.id}/dependencies`, { method: "PUT", json: { dependsOn: deps } });
      setDepsOpen(false);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function quickStatus(status: string) {
    setErr(null);
    try {
      await api(`/api/projects/${project.id}`, { method: "PATCH", json: { status, version: project.version } });
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      {err && <Notice kind="danger">{err}</Notice>}
      {openBlockers.length > 0 && <Notice kind="danger">Blocked: {openBlockers.map((b) => b.description).join("; ")}. Blocked projects are left out of schedule recommendations until resolved.</Notice>}

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card">
          <div className="label">Status</div>
          <div className="flex flex-wrap items-center gap-2"><StatusBadge status={project.status} /><PriorityBadge priority={project.priority} /></div>
          <div className="mt-2 flex flex-wrap gap-1">
            {project.status === "inquiry" && <button className="btn btn-sm" onClick={() => quickStatus("proposed")}>Mark proposed</button>}
            {(project.status === "inquiry" || project.status === "proposed") && <button className="btn btn-sm btn-primary" onClick={() => quickStatus("accepted")}>Client accepted</button>}
            {project.status === "accepted" && <button className="btn btn-sm btn-primary" onClick={() => quickStatus("in_progress")}>Start work</button>}
            {project.status === "in_progress" && <button className="btn btn-sm" onClick={() => quickStatus("completed")}>Mark complete</button>}
          </div>
        </div>
        <div className="card">
          <div className="label">Dates</div>
          <div className="text-sm space-y-0.5">
            <div><span className="muted">Accepted</span> {fmtDate(project.acceptanceDate)}</div>
            <div><span className="muted">Started</span> {fmtDate(project.actualStart)}</div>
            <div><span className="muted">Client due</span> <strong>{fmtDate(project.clientDueDate)}</strong></div>
            <div><span className="muted">Target</span> {fmtDate(project.targetCompletion)}</div>
            <div><span className="muted">Forecast</span> {forecast ? fmtDate(forecast) : "not scheduled"}</div>
          </div>
        </div>
        <div className="card">
          <div className="label">Effort</div>
          <div className="text-sm">
            <div>{fmtHours(project.actualHours)} logged of {fmtHours(project.estimatedHours)} est.</div>
            <div className="h-2 bg-surface-2 rounded mt-1 overflow-hidden"><div className={`h-full ${over ? "bg-danger" : "bg-accent"}`} style={{ width: `${pct}%` }} /></div>
            <div className="mt-1"><strong>{fmtHours(project.remaining)}</strong> remaining{project.remainingHours == null ? " (derived)" : ""} · {fmtHours(project.scheduledHours)} scheduled</div>
            <button className="link text-xs" onClick={() => setRemainingOpen(true)}>Update remaining</button>
          </div>
        </div>
        <div className="card">
          <div className="label">Fee</div>
          <div className="text-sm">
            <div className="text-lg font-semibold">{project.feeType === "hourly" ? `${fmtMoney(project.hourlyRate)}/h` : fmtMoney(project.feeAmount)}</div>
            <div className="muted">{project.feeType ?? "no basis set"}{approved.length ? ` · ${approved.length} approved estimate${approved.length > 1 ? "s" : ""}` : ""}</div>
            {addedHours > 0 && <div className="text-xs mt-1">+{fmtHours(addedHours)} added scope</div>}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 no-print">
        <button className="btn btn-primary" onClick={startTimer}>▶ Start timer</button>
        <button className="btn" onClick={() => setLogOpen(true)}>Log time</button>
        <Link href={`/estimates/new?projectId=${project.id}`} className="btn">New estimate</Link>
        <Link href={`/schedule?project=${project.id}`} className="btn">Schedule</Link>
        <button className="btn" onClick={() => setEditing(true)}>Edit details</button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Section title="Overview">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div><dt className="label">Client</dt><dd><Link className="link" href={`/clients/${project.clientId}`}>{project.clientName}</Link></dd></div>
              <div><dt className="label">Type / complexity</dt><dd>{project.projectTypeName ?? "–"} · {project.complexity}</dd></div>
              <div className="sm:col-span-2"><dt className="label">Address</dt><dd>{project.address ?? "–"}</dd></div>
              <div className="sm:col-span-2"><dt className="label">Scope</dt><dd className="whitespace-pre-wrap">{project.scope ?? "–"}</dd></div>
              {project.notes && <div className="sm:col-span-2"><dt className="label">Notes</dt><dd className="whitespace-pre-wrap">{project.notes}</dd></div>}
              {project.links.length > 0 && <div className="sm:col-span-2"><dt className="label">Links</dt><dd className="flex flex-wrap gap-3">{project.links.map((l, i) => <a key={i} className="link" href={l.url} target="_blank" rel="noreferrer">{l.label || l.url} ↗</a>)}</dd></div>}
              <div className="sm:col-span-2">
                <dt className="label">Depends on</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  {project.dependencies.length === 0 ? <span className="muted">nothing</span> : project.dependencies.map((d) => <Link key={d.dependsOnId} href={`/projects/${d.dependsOnId}`} className="badge bg-surface-2">{d.name} ({d.status.replace("_", " ")})</Link>)}
                  <button className="link text-xs" onClick={() => setDepsOpen(true)}>Edit</button>
                </dd>
              </div>
            </dl>
          </Section>

          <TasksPanel key={project.tasks.map((t) => `${t.id}:${t.version}`).join(",")} projectId={project.id} tasks={project.tasks} />
          <ItemsPanel projectId={project.id} items={project.items} />

          <Section title="Estimates" actions={<Link href={`/estimates/new?projectId=${project.id}`} className="btn btn-sm">New estimate</Link>}>
            {project.estimates.length === 0 ? <p className="text-sm muted">No estimates yet. Prepare one from the template or from similar completed projects.</p> : (
              <table className="table">
                <thead><tr><th>Rev</th><th>Scope</th><th>Status</th><th>Hours</th><th>Fee</th><th></th></tr></thead>
                <tbody>
                  {project.estimates.map((e) => (
                    <tr key={e.id}>
                      <td>{e.revision}</td><td>{e.scopeKind}</td><td><StatusBadge status={e.status} /></td><td>{fmtHours(e.totalHours)}</td><td>{fmtMoney(e.totalFee)}</td>
                      <td><Link className="link" href={`/estimates/${e.id}`}>Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Time" actions={<button className="btn btn-sm" onClick={() => setLogOpen(true)}>Log time</button>}>
            {project.timeEntries.length === 0 ? <p className="text-sm muted">No time logged yet.</p> : (
              <table className="table">
                <thead><tr><th>Date</th><th>Who</th><th>Duration</th><th className="hidden sm:table-cell">Notes</th></tr></thead>
                <tbody>
                  {project.timeEntries.slice(0, 25).map((t) => (
                    <tr key={t.id}>
                      <td>{fmtDateShort(t.entryDate)}</td><td>{t.userName}</td>
                      <td>{t.endedAt || t.source === "manual" ? fmtMinutes(t.durationMinutes) : <Pill tone="ok">running</Pill>}{!t.billable && <span className="text-xs muted"> · non-billable</span>}</td>
                      <td className="hidden sm:table-cell text-xs">{t.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {project.timeEntries.length > 25 && <Link href={`/time?projectId=${project.id}`} className="link text-sm">See all</Link>}
          </Section>

          <CorrespondenceList items={project.correspondence} clientId={project.clientId} projectId={project.id} />
        </div>

        <div className="space-y-4">
          <Section title="Scheduled work">
            {project.workBlocks.length === 0 ? <p className="text-sm muted">Not on the schedule yet.{isOwner ? " Generate a recommendation or add blocks on the Schedule page." : ""}</p> : (
              <ul className="text-sm space-y-1">
                {project.workBlocks.map((b) => (
                  <li key={b.id} className="flex justify-between"><span>{fmtDateShort(b.date)}{b.locked ? " 🔒" : ""}</span><span>{fmtHours(b.hours)}</span></li>
                ))}
              </ul>
            )}
          </Section>
          {openWaiting.length > 0 && (
            <Section title="Waiting on">
              <ul className="text-sm list-disc pl-4">{openWaiting.map((w) => <li key={w.id}>{w.description}</li>)}</ul>
            </Section>
          )}
          <HistoryList items={project.history} />
        </div>
      </div>

      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit project" wide>
        <ProjectForm id={project.id} version={project.version} onSaved={() => setEditing(false)} initial={{ clientId: project.clientId, name: project.name, address: project.address, projectTypeId: project.projectTypeId, scope: project.scope, complexity: project.complexity, status: project.status, priority: project.priority, tentativeReserve: project.tentativeReserve, inquiryDate: project.inquiryDate, acceptanceDate: project.acceptanceDate, plannedStart: project.plannedStart, actualStart: project.actualStart, targetCompletion: project.targetCompletion, clientDueDate: project.clientDueDate, actualCompletion: project.actualCompletion, estimatedHours: project.estimatedHours, remainingHours: project.remainingHours, feeType: project.feeType, feeAmount: project.feeAmount, hourlyRate: project.hourlyRate, notes: project.notes, links: project.links }} />
      </Dialog>
      <Dialog open={remainingOpen} onClose={() => setRemainingOpen(false)} title="Update remaining effort">
        <form onSubmit={saveRemaining} className="space-y-3">
          <p className="text-sm muted">Hours spent do not always equal progress. Enter your best current estimate of the hours still needed. Leave blank to go back to estimate − actual.</p>
          <input className="input" type="number" step="0.25" min="0" value={remaining} onChange={(e) => setRemaining(e.target.value)} autoFocus />
          <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={() => setRemainingOpen(false)}>Cancel</button><button className="btn btn-primary">Save</button></div>
        </form>
      </Dialog>
      <Dialog open={depsOpen} onClose={() => setDepsOpen(false)} title="Dependencies">
        <p className="text-sm muted mb-2">This project will not be recommended until the selected projects are complete.</p>
        <div className="max-h-64 overflow-y-auto space-y-1">
          {allProjects.filter((p) => p.id !== project.id).map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={deps.includes(p.id)} onChange={(e) => setDeps(e.target.checked ? [...deps, p.id] : deps.filter((d) => d !== p.id))} /> {p.name}</label>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-3"><button className="btn" onClick={() => setDepsOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={saveDeps}>Save</button></div>
      </Dialog>
      <LogTimeDialog open={logOpen} onClose={() => setLogOpen(false)} projectId={project.id} tasks={project.tasks.map((t) => ({ id: t.id, name: t.name }))} onSaved={() => router.refresh()} />
    </div>
  );
}
