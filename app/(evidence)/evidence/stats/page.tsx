import Link from "next/link";
import { getSession } from "@/lib/auth";
import { errorText } from "@/lib/api";
import { getEvidenceStats } from "@/lib/evidence-service";
import { Card, PageHeader, ErrorBox, NotLoggedIn } from "@/components/evidence/ui";
import StatsCharts from "@/components/evidence/StatsCharts";

export const dynamic = "force-dynamic";

const SEVERITY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

// Charts + tables for the report. SQL: GROUP BY/HAVING, anti-join, window function. Mongo: $unwind/$group.
export default async function StatsPage() {
  const session = await getSession();
  if (!session) return <NotLoggedIn />;

  let stats: Awaited<ReturnType<typeof getEvidenceStats>>;
  try {
    stats = await getEvidenceStats();
  } catch (e) {
    return <ErrorBox message={await errorText(e)} />;
  }
  const { sql, mongo } = stats;

  const severities = SEVERITY_ORDER.map((s) => ({
    label: s,
    value: Number(mongo?.severities.find((x: any) => x.severity === s)?.count ?? 0),
  }));

  return (
    <>
      <PageHeader title="Evidence statistics" />
      {!mongo && <div className="mb-4"><ErrorBox message="MongoDB is unreachable: the artifact charts are empty." /></div>}

      <StatsCharts
        perType={(sql.statusByType as any[]).map((r) => ({ label: r.type_name, value: Number(r.total) }))}
        perCustodian={(sql.perCustodian as any[]).map((r) => ({ label: r.full_name, value: Number(r.items_held) }))}
        severities={severities}
      />

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Custodians holding more than 3 items (HAVING)">
          <ul className="space-y-1 text-sm">
            {(sql.custodiansOver3 as any[]).map((r) => <li key={r.id}>{r.full_name} - <b>{r.items_held}</b> items</li>)}
            {sql.custodiansOver3.length === 0 && <li className="text-slate-500">Nobody.</li>}
          </ul>
        </Card>

        <Card title="Most transferred evidence">
          <ul className="space-y-1 text-sm">
            {(sql.mostTransferred as any[]).map((r) => (
              <li key={r.id}><Link className="text-blue-700 hover:underline" href={`/evidence/${r.id}`}>{r.file_name}</Link> - {r.transfer_count} transfers</li>
            ))}
          </ul>
        </Card>

        <Card title="Average hours between custody events (window function)">
          <ul className="space-y-1 text-sm">
            {(sql.avgGap as any[]).map((r) => <li key={r.type_name}>{r.type_name} - <b>{r.avg_hours_between}</b> h over {r.transfers} transfers</li>)}
          </ul>
        </Card>

        <Card title={`Never transferred (${sql.neverTransferred.length})`}>
          <ul className="space-y-1 text-sm">
            {(sql.neverTransferred as any[]).map((r) => (
              <li key={r.id}><Link className="text-blue-700 hover:underline" href={`/evidence/${r.id}`}>{r.file_name}</Link> - with {r.custodian}</li>
            ))}
          </ul>
        </Card>

        <Card title="High-severity findings per type (MongoDB)">
          <ul className="space-y-1 text-sm">
            {(mongo?.highSeverityByType ?? []).map((r: any) => <li key={r.evidence_type}>{r.evidence_type} - <b>{r.high_findings}</b> in {r.evidence_items} item(s)</li>)}
          </ul>
        </Card>

        <Card title="Top tags / mobile apps (MongoDB)">
          <p className="text-sm">
            <b>Tags:</b> {(mongo?.topTags ?? []).slice(0, 6).map((t: any) => `${t.tag} (${t.uses})`).join(", ") || "-"}
          </p>
          <p className="mt-2 text-sm">
            <b>Apps:</b> {(mongo?.topMobileApps ?? []).slice(0, 6).map((a: any) => `${a.app} (${a.devices})`).join(", ") || "-"}
          </p>
        </Card>
      </div>
    </>
  );
}
