import { getSession } from "@/lib/auth";
import { listTypes } from "@/lib/evidence-service";
import { Card, PageHeader, ErrorBox, NotLoggedIn } from "@/components/evidence/ui";
import NewEvidenceForm from "@/components/evidence/NewEvidenceForm";

export const dynamic = "force-dynamic";

export default async function NewEvidencePage() {
  const session = await getSession();
  if (!session) return <NotLoggedIn />;
  // Hiding the nav link is not enough: the page and POST /api/evidence both check the role too.
  if (session.role !== "ADMIN" && session.role !== "INVESTIGATOR")
    return <ErrorBox message="Only investigators and admins can register evidence." />;

  const types = await listTypes();
  return (
    <>
      <PageHeader title="Register evidence" />
      <Card className="max-w-2xl"><NewEvidenceForm types={types} /></Card>
    </>
  );
}
