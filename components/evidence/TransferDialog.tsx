"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { callApi } from "@/lib/client";
import { ErrorBox, btnCls, btnGhostCls, inputCls } from "@/components/evidence/ui";

// "Transfer custody" button + modal. Calls POST /api/transfers, which runs the transfer_custody
// stored procedure; any rule it rejects (inactive user, not the custodian, ...) is shown here.
export default function TransferDialog({
  evidenceId, fromUserId, users,
}: {
  evidenceId: number;
  fromUserId: number; // current custodian (an ADMIN acts on their behalf)
  users: { id: number; full_name: string }[];
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [toUser, setToUser] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await callApi("POST", "/api/transfers", {
      evidence_id: evidenceId, from_user_id: fromUserId, to_user_id: Number(toUser), reason,
    });
    setBusy(false);
    if (res.error) return setError(res.error);
    ref.current?.close();
    setToUser("");
    setReason("");
    router.refresh(); // re-run the server component: new custodian + new timeline entry
  }

  return (
    <>
      <button className={btnCls} onClick={() => ref.current?.showModal()}>Transfer custody</button>
      <dialog ref={ref} className="w-full max-w-md rounded-lg p-0 backdrop:bg-black/40">
        <form onSubmit={submit} className="space-y-3 p-5 text-slate-900">
          <h3 className="text-lg font-semibold">Transfer custody</h3>
          <label className="block text-sm font-medium">
            New custodian
            <select value={toUser} onChange={(e) => setToUser(e.target.value)} required className={`${inputCls} mt-1`}>
              <option value="">Select a user…</option>
              {users.filter((u) => u.id !== fromUserId).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Reason (min 5 characters)
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={255} rows={3} className={`${inputCls} mt-1`} />
          </label>
          {error && <ErrorBox message={error} />}
          <div className="flex justify-end gap-2">
            <button type="button" className={btnGhostCls} onClick={() => ref.current?.close()}>Cancel</button>
            <button disabled={busy || !toUser} className={btnCls}>{busy ? "Transferring…" : "Transfer"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
