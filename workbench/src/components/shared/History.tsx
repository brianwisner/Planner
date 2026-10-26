import { Section } from "@/components/ui/Form";
import { fmtDateTime } from "@/lib/format";

export function HistoryList({ items, title = "History" }: { items: { id: number; at: Date | string; action: string; summary: string; userName: string | null }[]; title?: string }) {
  return (
    <Section title={title}>
      {items.length === 0 ? <p className="text-sm muted">No changes recorded yet.</p> : (
        <ul className="space-y-2 text-xs">
          {items.map((h) => (
            <li key={h.id}>
              <div className="muted">{fmtDateTime(h.at as string)} · {h.userName ?? "system"}</div>
              <div>{h.summary}</div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
