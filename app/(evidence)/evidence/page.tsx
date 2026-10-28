import Link from "next/link";
import { getSession } from "@/lib/auth";
import { errorText } from "@/lib/api";
import { cleanParams, listEvidence, listTypes, listCustodians, STATUSES } from "@/lib/evidence-service";
import { buildQuery, fmtDate } from "@/lib/page-utils";
import { Card, PageHeader, StatusBadge, ErrorBox, NotLoggedIn, inputCls, btnCls, btnGhostCls } from "@/components/evidence/ui";

export const dynamic = "force-dynamic";

// Server component: reads from MySQL (view v_evidence_current) on the server and sends finished HTML.
// The filter bar is a plain <form method="get">: submitting it just reloads this page with new ?params,
// so the filters need no client-side JavaScript at all.
export default async function EvidenceListPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await getSession();
  if (!session) return <NotLoggedIn />;

  const params = cleanParams(searchParams);
  const [types, custodians] = await Promise.all([listTypes(), listCustodians()]);

  let result: Awaited<ReturnType<typeof listEvidence>> | null = null;
  let error = "";
  try {
    result = await listEvidence(params);
  } catch (e) {
    error = await errorText(e);
  }

  // Header cell that sorts by this column, flipping asc/desc when it is already the sort column.
  const SortHead = ({ col, label }: { col: string; label: string }) => {
    const active = result?.sort === col;
    const nextOrder = active && result?.order === "asc" ? "desc" : "asc";
    return (
      <th className="px-3 py-2 text-left font-semibold">
        <Link href={`/evidence${buildQuery(params, { sort: col, order: nextOrder, page: 1 })}`} className="hover:underline">
          {label}{active ? (result?.order === "asc" ? " ▲" : " ▼") : ""}
        </Link>
      </th>
    );
  };

  return (
    <>
      <PageHeader title="Evidence">
        {(session.role === "ADMIN" || session.role === "INVESTIGATOR") && (
          <Link href="/evidence/new" className={btnCls}>+ Add evidence</Link>
        )}
      </PageHeader>

      <Card className="mb-4">
        <form method="get" action="/evidence" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <input name="search" defaultValue={params.search ?? ""} placeholder="Search file name…" className={inputCls} />
          <select name="status" defaultValue={params.status ?? ""} className={inputCls}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select name="type" defaultValue={params.type ?? ""} className={inputCls}>
            <option value="">All types</option>
            {types.map((t) => <option key={t.id} value={t.type_name}>{t.type_name}</option>)}
          </select>
          <select name="custodian" defaultValue={params.custodian ?? ""} className={inputCls}>
            <option value="">Any custodian</option>
            {custodians.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
          <div className="flex gap-2">
            <button className={btnCls}>Filter</button>
            <Link href="/evidence" className={btnGhostCls}>Reset</Link>
          </div>
        </form>
      </Card>

      {error && <ErrorBox message={error} />}

      {result && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <SortHead col="id" label="#" />
                  <SortHead col="file_name" label="File" />
                  <SortHead col="type" label="Type" />
                  <SortHead col="status" label="Status" />
                  <SortHead col="custodian" label="Custodian" />
                  <SortHead col="collected_at" label="Collected" />
                </tr>
              </thead>
              <tbody>
                {result.items.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-500">{e.id}</td>
                    <td className="px-3 py-2 font-medium">
                      <Link href={`/evidence/${e.id}`} className="text-blue-700 hover:underline">{e.file_name}</Link>
                    </td>
                    <td className="px-3 py-2">{e.type_name}</td>
                    <td className="px-3 py-2"><StatusBadge status={e.status} /></td>
                    <td className="px-3 py-2">{e.custodian_name}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fmtDate(e.collected_at)}</td>
                  </tr>
                ))}
                {result.items.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No evidence matches these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
            <span>{result.total} item(s) · page {result.page} of {Math.max(result.totalPages, 1)}</span>
            <div className="flex gap-2">
              {result.page > 1 && <Link className={btnGhostCls} href={`/evidence${buildQuery(params, { page: result.page - 1 })}`}>← Previous</Link>}
              {result.page < result.totalPages && <Link className={btnGhostCls} href={`/evidence${buildQuery(params, { page: result.page + 1 })}`}>Next →</Link>}
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
