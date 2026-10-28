import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { errorText } from "@/lib/api";
import { getEvidenceDetail, listActiveUsers } from "@/lib/evidence-service";
import { fmtDate } from "@/lib/page-utils";
import { Card, PageHeader, StatusBadge, ErrorBox, NotLoggedIn } from "@/components/evidence/ui";
import TransferDialog from "@/components/evidence/TransferDialog";
import StatusControl from "@/components/evidence/StatusControl";
import ArtifactForm from "@/components/evidence/ArtifactForm";

export const dynamic = "force-dynamic";

// Server component: metadata + timeline come from MySQL views, the artifact from MongoDB.
// The tab is just a ?tab= query parameter, so switching tabs needs no client state.
export default async function EvidenceDetailPage({
  params, searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string };
}) {
  const session = await getSession();
  if (!session) return <NotLoggedIn />;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) notFound();

  let detail: Awaited<ReturnType<typeof getEvidenceDetail>> = null;
  try {
    detail = await getEvidenceDetail(id);
  } catch (e) {
    return <ErrorBox message={await errorText(e)} />;
  }
  if (!detail) notFound();
  const { evidence: ev, chain, artifact } = detail;

  const isFinal = ev.status === "RELEASED" || ev.status === "DESTROYED";
  // UI-only switches. The API (requireRole + the procedure) is what actually enforces these.
  const canTransfer = !isFinal && (session.role === "ADMIN" || session.userId === ev.custodian_id);
  const canChangeStatus = !isFinal && (session.role === "ADMIN" || session.role === "INVESTIGATOR");
  const canEditArtifacts = session.role === "ANALYST" || session.role === "INVESTIGATOR";
  const users = canTransfer ? await listActiveUsers() : [];

  const tab = searchParams.tab === "artifacts" ? "artifacts" : "custody";
  const tabCls = (active: boolean) =>
    `border-b-2 px-4 py-2 text-sm font-medium ${active ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"}`;

  // Mongo returns Date objects; JSON round-trip turns them into plain strings a client component can receive.
  const artifactProp = artifact ? JSON.parse(JSON.stringify(artifact)) : null;

  return (
    <>
      <PageHeader title={`#${ev.id} · ${ev.file_name}`}>
        <Link href="/evidence" className="text-sm text-blue-700 hover:underline">← All evidence</Link>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Status</dt><dd><StatusBadge status={ev.status} /></dd>
            <dt className="text-slate-500">Type</dt><dd>{ev.type_name}</dd>
            <dt className="text-slate-500">Collected by</dt><dd>{ev.collected_by_name}</dd>
            <dt className="text-slate-500">Collected at</dt><dd>{fmtDate(ev.collected_at)}</dd>
            <dt className="text-slate-500">Current custodian</dt><dd className="font-medium">{ev.custodian_name}</dd>
            <dt className="text-slate-500">SHA-256</dt><dd className="break-all font-mono text-xs">{ev.file_hash}</dd>
          </dl>
        </Card>

        <Card title="Actions">
          <div className="space-y-4">
            {canTransfer && <TransferDialog evidenceId={ev.id} fromUserId={ev.custodian_id} users={users} />}
            {canChangeStatus && <StatusControl evidenceId={ev.id} current={ev.status} />}
            <Link href="/evidence/verify" className="block text-sm text-blue-700 hover:underline">Verify a file against this hash →</Link>
            {isFinal && <p className="text-xs text-slate-500">This evidence is {ev.status} and can no longer be changed or transferred.</p>}
            {!canTransfer && !canChangeStatus && !isFinal && (
              <p className="text-xs text-slate-500">Only the current custodian (or an admin) can transfer this evidence.</p>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-6 flex border-b border-slate-200">
        <Link href={`/evidence/${ev.id}`} className={tabCls(tab === "custody")}>Chain of custody</Link>
        <Link href={`/evidence/${ev.id}?tab=artifacts`} className={tabCls(tab === "artifacts")}>Artifacts</Link>
      </div>

      <div className="mt-4">
        {tab === "custody" ? (
          <Card>
            <ol className="relative ml-3 border-l-2 border-slate-200">
              <li className="mb-6 ml-5">
                <span className="absolute -left-[9px] h-4 w-4 rounded-full border-2 border-white bg-green-500" />
                <p className="text-sm font-semibold">Collected by {ev.collected_by_name}</p>
                <p className="text-xs text-slate-500">{fmtDate(ev.collected_at)}</p>
              </li>
              {chain.map((t) => (
                <li key={t.transfer_seq} className="mb-6 ml-5">
                  <span className="absolute -left-[9px] h-4 w-4 rounded-full border-2 border-white bg-blue-500" />
                  <p className="text-sm font-semibold">#{t.transfer_seq} · {t.from_user} → {t.to_user}</p>
                  <p className="text-sm text-slate-700">{t.reason}</p>
                  <p className="text-xs text-slate-500">{fmtDate(t.transferred_at)}</p>
                </li>
              ))}
              <li className="ml-5">
                <span className="absolute -left-[9px] h-4 w-4 rounded-full border-2 border-white bg-slate-800" />
                <p className="text-sm font-semibold">Now held by {ev.custodian_name}</p>
              </li>
            </ol>
            {chain.length === 0 && <p className="mt-3 text-sm text-slate-500">Never transferred - still with the collector.</p>}
          </Card>
        ) : (
          <Card>
            <ArtifactForm evidenceId={ev.id} evidenceType={ev.type_name} initial={artifactProp} canEdit={canEditArtifacts} />
          </Card>
        )}
      </div>
    </>
  );
}
