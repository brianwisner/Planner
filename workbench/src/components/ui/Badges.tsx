import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/format";

const STATUS_CLS: Record<string, string> = {
  inquiry: "bg-surface-2 text-muted",
  proposed: "bg-info-soft text-info",
  accepted: "bg-accent-soft text-accent",
  in_progress: "bg-ok-soft text-ok",
  on_hold: "bg-warn-soft text-warn",
  completed: "bg-surface-2 text-muted",
  declined: "bg-surface-2 text-muted line-through",
  draft: "bg-surface-2 text-muted",
  submitted: "bg-warn-soft text-warn",
  approved: "bg-ok-soft text-ok",
  rejected: "bg-danger-soft text-danger",
  superseded: "bg-surface-2 text-muted",
  proposed_schedule: "bg-warn-soft text-warn",
  open: "bg-warn-soft text-warn",
  resolved: "bg-surface-2 text-muted",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STATUS_CLS[status] ?? "bg-surface-2 text-muted"}`}>{STATUS_LABELS[status] ?? status.replace(/_/g, " ")}</span>;
}

export function PriorityBadge({ priority }: { priority: number }) {
  const cls = priority === 1 ? "bg-danger-soft text-danger" : priority === 2 ? "bg-warn-soft text-warn" : priority === 4 ? "bg-surface-2 text-muted" : "bg-surface-2 text-ink";
  return <span className={`badge ${cls}`}>{PRIORITY_LABELS[priority] ?? priority}</span>;
}

export function Pill({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "ok" | "warn" | "danger" | "info" | "accent" }) {
  const cls = { muted: "bg-surface-2 text-muted", ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", danger: "bg-danger-soft text-danger", info: "bg-info-soft text-info", accent: "bg-accent-soft text-accent" }[tone];
  return <span className={`badge ${cls}`}>{children}</span>;
}
