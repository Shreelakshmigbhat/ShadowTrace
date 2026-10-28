"use client";
import { useState } from "react";
import { callApi, sha256Hex } from "@/lib/client";
import { ErrorBox, inputCls, btnCls } from "@/components/evidence/ui";

type Result = { stored: string; computed: string; match: boolean; name: string };

// Integrity check demo: recompute the SHA-256 of a file and compare it with the hash stored in MySQL.
// One changed byte gives a completely different hash, which is how tampering is detected.
export default function VerifyForm({ items }: { items: { id: number; file_name: string }[] }) {
  const [id, setId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !id) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const computed = await sha256Hex(file);
      const res = await callApi<{ evidence: { file_hash: string; file_name: string } }>("GET", `/api/evidence/${id}`);
      if (res.error) throw new Error(res.error);
      const stored = res.data!.evidence.file_hash;
      setResult({ stored, computed, match: stored === computed, name: res.data!.evidence.file_name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block text-sm font-medium">
        Evidence record
        <select value={id} onChange={(e) => setId(e.target.value)} required className={`${inputCls} mt-1`}>
          <option value="">Select…</option>
          {items.map((i) => <option key={i.id} value={i.id}>#{i.id} - {i.file_name}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium">
        File to check
        <input type="file" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} required className={`${inputCls} mt-1`} />
      </label>
      <button disabled={busy || !file || !id} className={btnCls}>{busy ? "Hashing…" : "Verify integrity"}</button>

      {error && <ErrorBox message={error} />}
      {result && (
        <div className={`rounded border p-3 text-sm ${result.match ? "border-green-300 bg-green-50 text-green-900" : "border-red-300 bg-red-50 text-red-900"}`}>
          <p className="font-semibold">
            {result.match ? "✔ Hashes match - the file is identical to the registered evidence." : "✘ Hashes DO NOT match - the file differs from the registered evidence."}
          </p>
          <p className="mt-2 text-xs">Stored in database:</p>
          <p className="break-all font-mono text-xs">{result.stored}</p>
          <p className="mt-2 text-xs">Computed from your file:</p>
          <p className="break-all font-mono text-xs">{result.computed}</p>
        </div>
      )}
    </form>
  );
}
