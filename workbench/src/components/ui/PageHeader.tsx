export function PageHeader({ title, subtitle, actions, back }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; back?: React.ReactNode }) {
  return (
    <div className="mb-5">
      {back && <div className="text-sm mb-1">{back}</div>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="h1">{title}</h1>
          {subtitle && <div className="text-sm muted mt-0.5">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2 no-print">{actions}</div>}
      </div>
    </div>
  );
}
