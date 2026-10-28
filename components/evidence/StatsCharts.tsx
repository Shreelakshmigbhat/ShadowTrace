"use client";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// recharts draws in the browser, so this is a client component. It only receives plain arrays.
type Point = { label: string; value: number };

const SEVERITY_COLORS: Record<string, string> = {
  LOW: "#16a34a", MEDIUM: "#ca8a04", HIGH: "#ea580c", CRITICAL: "#dc2626",
};

function Chart({ title, data, horizontal = false, colorFor }: {
  title: string; data: Point[]; horizontal?: boolean; colorFor?: (label: string) => string;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {data.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">No data yet.</p>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ left: horizontal ? 40 : 0, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              {horizontal ? (
                <>
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 12 }} />
                </>
              ) : (
                <>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} />
                  <YAxis allowDecimals={false} />
                </>
              )}
              <Tooltip />
              <Bar dataKey="value" name="Count" fill="#2563eb" radius={3}>
                {colorFor && data.map((d) => <Cell key={d.label} fill={colorFor(d.label)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

export default function StatsCharts({ perType, perCustodian, severities }: {
  perType: Point[]; perCustodian: Point[]; severities: Point[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Chart title="Evidence per type (MySQL)" data={perType} />
      <Chart title="Evidence per custodian (MySQL)" data={perCustodian} horizontal />
      <div className="lg:col-span-2">
        <Chart title="Findings by severity (MongoDB)" data={severities} colorFor={(l) => SEVERITY_COLORS[l] ?? "#64748b"} />
      </div>
    </div>
  );
}
