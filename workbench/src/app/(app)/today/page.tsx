import Link from "next/link";
import { DateTime } from "luxon";
import { requireUser } from "@/lib/auth/session";
import { getTodayData } from "@/lib/services/today";
import { getOwnerId } from "@/lib/services/users";
import { fmtDateShort, fmtHours, fmtMinutes } from "@/lib/format";
import { Pill, StatusBadge } from "@/components/ui/Badges";
import { TodayActions, StartTimerButton } from "@/components/today/TodayActions";
import { WeekLoadChart } from "@/components/reports/Charts";
import { Notice } from "@/components/ui/Notice";

export const metadata = { title: "Today" };

export default async function TodayPage() {
  const user = await requireUser();
  const ownerId = await getOwnerId();
  const scheduleUserId = user.role === "owner" ? user.id : ownerId ?? user.id;
  const d = await getTodayData(user.id, user.timezone, scheduleUserId);
  const cap = d.todayCap;
  const isOwner = user.role === "owner";
  const dateLabel = DateTime.fromISO(d.today, { zone: user.timezone }).toFormat("EEEE, LLLL d");
  const approvals = d.pendingEstimates.length + d.proposals.length;
  const workToday = cap.blocks.filter((b) => b.kind === "work");
  const commitments = cap.blocks.filter((b) => b.kind === "commitment");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm muted">{dateLabel}</div>
          <h1 className="h1">Good {DateTime.now().setZone(user.timezone).hour < 12 ? "morning" : "afternoon"}, {user.name.split(" ")[0]}</h1>
        </div>
        <TodayActions projects={d.projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName }))} />
      </div>

      {d.projects.length === 0 && d.pipeline.length === 0 && (
        <Notice kind="info">
          Nothing is planned yet. Start by <Link className="underline" href="/clients/new">adding a client</Link>, then a project, then an estimate. Set your working hours in <Link className="underline" href="/settings/hours">Settings → Working hours</Link> so the schedule knows your capacity.
        </Notice>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {/* Capacity today */}
        <div className="card">
          <div className="label">Available today</div>
          <div className="text-3xl font-semibold">{cap.off ? "Day off" : fmtHours(cap.availableHours)}</div>
          {!cap.off && (
            <div className="text-xs muted mt-1">
              {fmtHours(cap.grossHours)} window − {fmtHours(cap.breakHours)} break − {fmtHours(cap.eventHours)} appointments − {fmtHours(cap.bufferHours)} buffer
            </div>
          )}
          <div className={`text-sm mt-2 ${cap.overbooked ? "text-danger" : ""}`}>{fmtHours(cap.plannedHours)} scheduled{cap.overbooked ? ` · overbooked by ${fmtHours(cap.overbookedBy)}` : ""}</div>
          <div className="text-sm">{fmtMinutes(d.loggedMinutes)} logged so far</div>
        </div>
        {/* Appointments */}
        <div className="card">
          <div className="label">Calendar appointments</div>
          {cap.events.length === 0 ? <p className="text-sm muted">None today.{" "}<Link href="/settings/google" className="link">Connect Google Calendar</Link> to see them here.</p> : (
            <ul className="text-sm space-y-1">
              {cap.events.map((e, i) => (
                <li key={i} className="flex justify-between gap-2"><span className="truncate">{e.summary}</span><span className="muted whitespace-nowrap">{e.allDay ? "all day" : `${DateTime.fromISO(e.start).setZone(user.timezone).toFormat("h:mm a")} · ${fmtMinutes(e.minutes)}`}</span></li>
              ))}
            </ul>
          )}
        </div>
        {/* Approvals */}
        <div className="card">
          <div className="label">{isOwner ? "Needs your decision" : "Awaiting Brian's approval"}</div>
          {approvals === 0 ? <p className="text-sm muted">Nothing waiting.</p> : (
            <ul className="text-sm space-y-1">
              {d.pendingEstimates.map((e) => <li key={`e${e.id}`}><Link className="link" href={`/estimates/${e.id}`}>Estimate rev {e.revision} · {e.projectName}</Link> <span className="muted">({fmtHours(e.totalHours)}, by {e.preparedByName})</span></li>)}
              {d.proposals.map((p) => <li key={`p${p.id}`}><Link className="link" href={`/schedule/proposals/${p.id}`}>Schedule: {p.title}</Link> <span className="muted">({p.summary.moves.length} changes, by {p.createdByName})</span></li>)}
            </ul>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <section className="card">
            <div className="flex items-center justify-between mb-2"><h2 className="h2">Work on today</h2><Link href="/schedule" className="link text-sm">Schedule →</Link></div>
            {workToday.length === 0 ? (
              <p className="text-sm muted">No work blocks scheduled for today.{isOwner ? <> Generate a <Link className="link" href="/schedule?tab=proposals">recommendation</Link> or add work on the Schedule page.</> : " Ask Brian to approve a schedule, or propose one from the Schedule page."}</p>
            ) : (
              <ol className="divide-y divide-line">
                {workToday.map((b, i) => (
                  <li key={b.id} className="py-2 flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-accent-soft text-accent text-xs flex items-center justify-center shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <Link href={`/projects/${b.projectId}`} className="font-medium link">{b.projectName}</Link>{b.locked && " 🔒"}
                      <div className="text-xs muted">{fmtHours(b.hours)} planned{b.clientDueDate ? ` · due ${fmtDateShort(b.clientDueDate)}` : ""}{b.note ? ` · ${b.note}` : ""}</div>
                    </div>
                    {b.projectId && <StartTimerButton projectId={b.projectId} />}
                  </li>
                ))}
              </ol>
            )}
            {commitments.length > 0 && (
              <div className="mt-3 text-sm"><span className="label">Fixed commitments</span>{commitments.map((c) => <div key={c.id}>{c.title} · {fmtHours(c.hours)}{c.startMinute != null ? ` at ${Math.floor(c.startMinute / 60)}:${String(c.startMinute % 60).padStart(2, "0")}` : ""}</div>)}</div>
            )}
          </section>

          <section className="card">
            <h2 className="h2 mb-2">This week: planned vs available</h2>
            <WeekLoadChart data={d.week.map((w) => ({ date: w.date, available: w.availableHours, planned: w.plannedHours, off: w.off }))} />
          </section>

          <section className="card">
            <h2 className="h2 mb-2">Deadlines & work at risk</h2>
            {d.deadlines.length === 0 ? <p className="text-sm muted">No client due dates or targets in the next two weeks, and nothing forecast late.</p> : (
              <ul className="divide-y divide-line text-sm">
                {d.deadlines.map((p) => (
                  <li key={p.id} className="py-2 flex flex-wrap items-center gap-2">
                    <Link href={`/projects/${p.id}`} className="link font-medium">{p.name}</Link>
                    <span className="muted">{p.clientDueDate ? "client due" : "target"} {fmtDateShort(p.due)}</span>
                    <span className="muted">· {fmtHours(p.remaining)} left</span>
                    <span className="ml-auto flex gap-1">
                      {p.overdue && <Pill tone="danger">overdue</Pill>}
                      {!p.overdue && p.atRisk && <Pill tone="warn">{p.unscheduled ? "not scheduled" : `forecast ${fmtDateShort(p.forecast)}`}</Pill>}
                      {!p.atRisk && !p.overdue && <Pill tone="ok">on track</Pill>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className="card">
            <h2 className="h2 mb-2">Blockers & waiting</h2>
            {d.openItems.length === 0 ? <p className="text-sm muted">Nothing blocked.</p> : (
              <ul className="text-sm space-y-2">
                {d.openItems.map((it) => (
                  <li key={it.id}><Pill tone={it.kind === "blocker" ? "danger" : "warn"}>{it.kind}</Pill> <Link className="link" href={`/projects/${it.projectId}`}>{it.projectName}</Link><div className="text-xs">{it.description}</div></li>
                ))}
              </ul>
            )}
          </section>
          <section className="card">
            <h2 className="h2 mb-2">Logged today</h2>
            {d.timeToday.length === 0 ? <p className="text-sm muted">No time entries yet. Start a timer from a work block, or log time manually.</p> : (
              <ul className="text-sm space-y-1">{d.timeToday.map((t) => <li key={t.id} className="flex justify-between gap-2"><span className="truncate">{t.projectName}</span><span className="muted">{t.endedAt || t.source === "manual" ? fmtMinutes(t.durationMinutes) : "running"}</span></li>)}</ul>
            )}
            <Link href="/time" className="link text-sm">Time sheet →</Link>
          </section>
          {d.pipeline.length > 0 && (
            <section className="card">
              <h2 className="h2 mb-2">Pipeline</h2>
              <ul className="text-sm space-y-1">{d.pipeline.slice(0, 8).map((p) => <li key={p.id} className="flex justify-between gap-2"><Link className="link truncate" href={`/projects/${p.id}`}>{p.name}</Link><StatusBadge status={p.status} /></li>)}</ul>
              <p className="text-xs muted mt-2">Opportunities stay out of committed workload until accepted (or marked tentative).</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
