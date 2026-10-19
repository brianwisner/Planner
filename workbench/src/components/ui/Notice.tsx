export function Notice({ kind = "info", children }: { kind?: "info" | "warn" | "danger" | "ok"; children: React.ReactNode }) {
  const cls = {
    info: "bg-info-soft text-info border-info/20",
    warn: "bg-warn-soft text-warn border-warn/20",
    danger: "bg-danger-soft text-danger border-danger/20",
    ok: "bg-ok-soft text-ok border-ok/20",
  }[kind];
  return <div className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="card text-center py-10">
      <div className="text-base font-medium">{title}</div>
      {children && <div className="text-sm muted mt-1 max-w-md mx-auto">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
