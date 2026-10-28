import Link from "next/link";
import { getSession } from "@/lib/auth";
import { errorText } from "@/lib/api";
import { cleanParams, listAudit, listActiveUsers } from "@/lib/evidence-service";
import { buildQuery, fmtDate } from "@/lib/page-utils";
import { Card, PageHeader, ErrorBox, NotLoggedIn, inputCls, btnCls, btnGhostCls } from "@/components/evidence/ui";

export const dynamic = "force-dynamic";

const ACTIONS = ["INSERT", "UPDATE", "DELETE", "TRANSFER", "LOGIN"];
const ACTION_STYLES: Record<string, string> = {
  INSERT: "bg-green-100 text-green-800", UPDATE: "bg-amber-100 text-amber-800", DELETE: "bg-red-100 text-red-800",
  TRANSFER: "bg-blue-100 text-blue-800", LOGIN: "bg-slate-200 text-slate-800",
};

// Admin-only. The rows are written by MySQL triggers, so nobody (not even an admin) can edit them.
export default async function AuditPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await getSession();
  if (!session) return <NotLoggedIn />;
  if (session.role !== "ADMIN") return <ErrorBox message="The audit log is visible to administrators only." />;

  const params = cleanParams(searchParams);
  const users = await listActiveUsers();
  let result: Awaited<ReturnType<typeof listAudit>> | null = null;
  let error = "";
  try {
    result = await listAudit(params);
  } catch (e) {
    error = await errorText(e);
  }

  return (
    <>
      <PageHeader title="Audit log" />
      <Card className="mb-4">
        <form method="get" action="/audit" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <select name="action" defaultValue={params.action ?? ""} className={inputCls}>
            <option value="">Any action</option>
            {ACTIONS.map((a) => <option key={a}>{a}</option>)}
          </select>
          <input name="table" defaultValue={params.table ?? ""} placeholder="Table (e.g. evidence)" className={inputCls} />
          <input name="target_id" type="number" min={1} defaultValue={params.target_id ?? ""} placeholder="Target id" className={inputCls} />
          <select name="user" defaultValue={params.user ?? ""} className={inputCls}>
            <option value="">Any user</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <input name="from" type="date" defaultValue={params.from ?? ""} className={inputCls} aria-label="From date" />
          <input name="to" type="date" defaultValue={params.to ?? ""} className={inputCls} aria-label="To date" />
          <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
            <button className={btnCls}>Filter</button>
            <Link href="/audit" className={btnGhostCls}>Reset</Link>
          </div>
        </form>
      </Card>

      {error && <ErrorBox message={error} />}
      {result && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">#</th><th className="px-3 py-2">When</th><th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Target</th><th className="px-3 py-2">Who</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100">
                    <td className="px-3 py-2 text-slate-500">{a.id}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(a.created_at)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ACTION_STYLES[a.action] ?? ""}`}>{a.action}</span>
                    </td>
                    <td className="px-3 py-2">
                      {a.target_table === "evidence"
                        ? <Link href={`/evidence/${a.target_id}`} className="text-blue-700 hover:underline">evidence #{a.target_id}</Link>
                        : `${a.target_table} #${a.target_id}`}
                    </td>
                    <td className="px-3 py-2">{a.user_name ?? <span className="text-slate-400">system / unknown</span>}</td>
                  </tr>
                ))}
                {result.items.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">No audit entries match.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
            <span>{result.total} entries · page {result.page} of {Math.max(result.totalPages, 1)}</span>
            <div className="flex gap-2">
              {result.page > 1 && <Link className={btnGhostCls} href={`/audit${buildQuery(params, { page: result.page - 1 })}`}>← Previous</Link>}
              {result.page < result.totalPages && <Link className={btnGhostCls} href={`/audit${buildQuery(params, { page: result.page + 1 })}`}>Next →</Link>}
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
