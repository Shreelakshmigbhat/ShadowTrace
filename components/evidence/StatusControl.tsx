"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { callApi } from "@/lib/client";
import { ErrorBox, btnCls, inputCls } from "@/components/evidence/ui";

const STATUSES = ["COLLECTED", "IN_ANALYSIS", "IN_STORAGE", "RELEASED", "DESTROYED"];

// Status dropdown + Save. PATCH /api/evidence/:id/status locks the row and refuses final statuses.
export default function StatusControl({ evidenceId, current }: { evidenceId: number; current: string }) {
  const router = useRouter();
  const [status, setStatus] = useState(current);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError("");
    const res = await callApi("PATCH", `/api/evidence/${evidenceId}/status`, { status });
    setBusy(false);
    if (res.error) return setError(res.error);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button onClick={save} disabled={busy || status === current} className={btnCls}>Save</button>
      </div>
      {error && <ErrorBox message={error} />}
    </div>
  );
}
