// Small presentational pieces shared by the evidence pages (no state, so usable from server components).
import type { ReactNode } from "react";

export const inputCls =
  "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none disabled:bg-slate-100";
export const btnCls =
  "inline-flex items-center rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50";
export const btnGhostCls =
  "inline-flex items-center rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50";

const STATUS_STYLES: Record<string, string> = {
  COLLECTED: "bg-blue-100 text-blue-800",
  IN_ANALYSIS: "bg-amber-100 text-amber-800",
  IN_STORAGE: "bg-slate-200 text-slate-800",
  RELEASED: "bg-green-100 text-green-800",
  DESTROYED: "bg-red-100 text-red-800",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[status] ?? "bg-slate-100"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

export function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {title && <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>}
      {children}
    </section>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{message}</p>;
}

export function NotLoggedIn() {
  return (
    <ErrorBox message="Not logged in. (Stub auth: set DEV_USER_ID and DEV_ROLE in .env.local and restart the dev server.)" />
  );
}
