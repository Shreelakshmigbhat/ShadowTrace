import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { Card, PageHeader, NotLoggedIn } from "@/components/evidence/ui";
import VerifyForm from "@/components/evidence/VerifyForm";

export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  const session = await getSession();
  if (!session) return <NotLoggedIn />;

  const items = await query<{ id: number; file_name: string }>("SELECT id, file_name FROM evidence ORDER BY id");
  return (
    <>
      <PageHeader title="Verify file integrity" />
      <Card className="max-w-2xl">
        <p className="mb-4 text-sm text-slate-600">
          The file is hashed in your browser and never uploaded. If even one byte differs from the registered
          evidence, the SHA-256 hash will not match.
        </p>
        <VerifyForm items={items} />
      </Card>
    </>
  );
}
