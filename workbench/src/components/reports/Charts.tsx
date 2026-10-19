"use client";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, Line, LineChart, ReferenceLine } from "recharts";
import { DateTime } from "luxon";

const C = { available: "#c9d6d4", planned: "#0f6e6a", over: "#b91c1c", est: "#8aa8a5", actual: "#0f6e6a", remaining: "#d9a441" };

export function WeekLoadChart({ data }: { data: { date: string; available: number; planned: number; off: boolean }[] }) {
  const rows = data.map((d) => ({ ...d, label: DateTime.fromISO(d.date).toFormat("EEE d"), over: Math.max(0, d.planned - d.available), within: Math.min(d.planned, d.available) }));
  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} unit="h" />
          <Tooltip formatter={(v, n) => [`${v} h`, n === "available" ? "Available" : n === "within" ? "Planned" : "Over capacity"]} />
          <Bar dataKey="available" fill={C.available} name="available" radius={[4, 4, 0, 0]} />
          <Bar dataKey="within" stackId="p" fill={C.planned} name="within" />
          <Bar dataKey="over" stackId="p" fill={C.over} name="over" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WorkloadChart({ data }: { data: { label: string; available: number; planned: number }[] }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} unit="h" />
          <Tooltip formatter={(v) => `${v} h`} />
          <Legend />
          <Bar dataKey="available" fill={C.available} name="Available" radius={[4, 4, 0, 0]} />
          <Bar dataKey="planned" fill={C.planned} name="Planned" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function EstVsActualChart({ data }: { data: { name: string; estimated: number; actual: number; remaining: number }[] }) {
  return (
    <div style={{ height: Math.max(200, data.length * 36 + 40) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 12 }} unit="h" />
          <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(v) => `${v} h`} />
          <Legend />
          <Bar dataKey="estimated" fill={C.est} name="Estimated" radius={[0, 4, 4, 0]} />
          <Bar dataKey="actual" stackId="a" fill={C.actual} name="Actual" />
          <Bar dataKey="remaining" stackId="a" fill={C.remaining} name="Remaining" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AccuracyChart({ data }: { data: { type: string; ratio: number; count: number }[] }) {
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="type" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={50} />
          <YAxis tick={{ fontSize: 12 }} domain={[0, "auto"]} />
          <ReferenceLine y={1} stroke="#6b7280" strokeDasharray="4 4" label={{ value: "on estimate", fontSize: 11, position: "insideTopRight" }} />
          <Tooltip formatter={(v, n) => (n === "ratio" ? [`${v}× (actual ÷ estimate)`, "Ratio"] : [String(v), String(n)])} />
          <Line type="monotone" dataKey="ratio" stroke={C.planned} strokeWidth={2} dot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
