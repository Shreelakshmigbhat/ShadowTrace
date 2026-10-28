import Link from "next/link";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Shared frame for all evidence pages. Links are hidden when the role cannot use them;
// that is only convenience - every API route and page still checks the role itself.
export default async function EvidenceLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const role = session?.role;
  const link = "rounded px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4 py-2">
          <span className="mr-3 font-bold text-blue-700">ShadowTrace</span>
          <Link href="/evidence" className={link}>Evidence</Link>
          {(role === "ADMIN" || role === "INVESTIGATOR") && <Link href="/evidence/new" className={link}>Add evidence</Link>}
          <Link href="/evidence/verify" className={link}>Verify hash</Link>
          <Link href="/evidence/stats" className={link}>Statistics</Link>
          {role === "ADMIN" && <Link href="/audit" className={link}>Audit log</Link>}
          <span className="ml-auto text-xs text-slate-500">
            {session ? `User #${session.userId} · ${session.role}` : "not logged in"}
          </span>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
