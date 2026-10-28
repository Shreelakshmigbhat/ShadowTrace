"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { callApi, sha256Hex } from "@/lib/client";
import { ErrorBox, btnCls, inputCls } from "@/components/evidence/ui";

// Picks a file, hashes it IN THE BROWSER, and sends only { file_name, file_hash, ... } to the API.
// The file itself never leaves the user's machine (we store metadata, not the file).
export default function NewEvidenceForm({ types }: { types: { id: number; type_name: string }[] }) {
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [hash, setHash] = useState("");
  const [hashing, setHashing] = useState(false);
  const [typeId, setTypeId] = useState("");
  const [collectedAt, setCollectedAt] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setHash("");
    setError("");
    if (!file) return;
    setFileName(file.name);
    setHashing(true);
    try {
      setHash(await sha256Hex(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not hash the file");
    } finally {
      setHashing(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const res = await callApi<{ id: number }>("POST", "/api/evidence", {
      file_name: fileName,
      file_hash: hash,
      evidence_type_id: Number(typeId),
      // datetime-local has no timezone; we treat what the user typed as UTC to match the database
      collected_at: collectedAt ? new Date(collectedAt + "Z").toISOString() : undefined,
    });
    setSaving(false);
    if (res.error) return setError(res.error); // e.g. "this file hash is already registered"
    router.push(`/evidence/${res.data!.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block text-sm font-medium">
        Evidence file (hashed locally, not uploaded)
        <input type="file" onChange={onFile} className={`${inputCls} mt-1`} required />
      </label>

      <label className="block text-sm font-medium">
        File name
        <input value={fileName} onChange={(e) => setFileName(e.target.value)} maxLength={255} required className={`${inputCls} mt-1`} />
      </label>

      <div className="text-sm font-medium">
        SHA-256 hash
        <p className="mt-1 break-all rounded bg-slate-100 p-2 font-mono text-xs text-slate-700">
          {hashing ? "Computing…" : hash || "Choose a file to compute its hash"}
        </p>
      </div>

      <label className="block text-sm font-medium">
        Evidence type
        <select value={typeId} onChange={(e) => setTypeId(e.target.value)} required className={`${inputCls} mt-1`}>
          <option value="">Select…</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.type_name}</option>)}
        </select>
      </label>

      <label className="block text-sm font-medium">
        Collected at (UTC, optional - defaults to now)
        <input type="datetime-local" value={collectedAt} onChange={(e) => setCollectedAt(e.target.value)} className={`${inputCls} mt-1`} />
      </label>

      {error && <ErrorBox message={error} />}
      <button disabled={!hash || !typeId || saving} className={btnCls}>{saving ? "Saving…" : "Register evidence"}</button>
    </form>
  );
}
