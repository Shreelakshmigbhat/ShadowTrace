"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { callApi } from "@/lib/client";
import { ErrorBox, btnCls, btnGhostCls, inputCls } from "@/components/evidence/ui";

// Renders the MongoDB artifact document as a form. WHICH fields appear depends on the evidence type -
// this is the "flexible schema" idea made visible. MongoDB's $jsonSchema validator is the real rule-keeper.

type Col = { key: string; label: string; number?: boolean };
type Field =
  | { path: string; label: string; kind: "text" | "number" | "list"; hint?: string }
  | { path: string; label: string; kind: "select"; options: string[] }
  | { path: string; label: string; kind: "rows"; cols: Col[] };

// "list" = comma-separated text <-> array of strings. Paths like "date_range.from" mean nested objects.
const SPECS: Record<string, Field[]> = {
  "Mobile Device": [
    { path: "imei", label: "IMEI (15 digits)", kind: "text" },
    { path: "os", label: "Operating system", kind: "select", options: ["Android", "iOS"] },
    { path: "os_version", label: "OS version", kind: "text" },
    { path: "installed_apps", label: "Installed apps", kind: "list", hint: "comma separated" },
    { path: "contacts_count", label: "Contacts", kind: "number" },
  ],
  "Disk Image": [
    { path: "imaging_tool", label: "Imaging tool", kind: "text" },
    { path: "total_size_gb", label: "Total size (GB)", kind: "number" },
    { path: "partitions", label: "Partitions", kind: "rows", cols: [
      { key: "name", label: "Name" }, { key: "filesystem", label: "Filesystem" }, { key: "size_gb", label: "Size GB", number: true },
    ] },
  ],
  "Network Capture": [
    { path: "protocols", label: "Protocols", kind: "list", hint: "comma separated" },
    { path: "duration_sec", label: "Duration (seconds)", kind: "number" },
    { path: "top_talkers", label: "Top talkers", kind: "rows", cols: [
      { key: "ip", label: "IP address" }, { key: "bytes", label: "Bytes", number: true },
    ] },
  ],
  "Email Archive": [
    { path: "mailbox", label: "Mailbox", kind: "text" },
    { path: "message_count", label: "Message count", kind: "number" },
    { path: "date_range.from", label: "Messages from (YYYY-MM-DD)", kind: "text" },
    { path: "date_range.to", label: "Messages to (YYYY-MM-DD)", kind: "text" },
  ],
  "CCTV Footage": [
    { path: "camera_id", label: "Camera ID", kind: "text" },
    { path: "duration_sec", label: "Duration (seconds)", kind: "number" },
    { path: "resolution", label: "Resolution (e.g. 1920x1080)", kind: "text" },
    { path: "frame_rate", label: "Frame rate", kind: "number" },
  ],
  "Document Scan": [
    { path: "page_count", label: "Pages", kind: "number" },
    { path: "scan_dpi", label: "Scan DPI", kind: "number" },
    { path: "language", label: "Language", kind: "text" },
  ],
};

const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

const getPath = (o: any, p: string) => p.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
function setPath(o: any, p: string, v: any) {
  const keys = p.split(".");
  let cur = o;
  for (const k of keys.slice(0, -1)) {
    if (cur[k] == null) cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = v;
}

// document values -> text the inputs can show (everything is a string while editing)
function toForm(fields: Field[], details: any): Record<string, any> {
  const vals: Record<string, any> = {};
  for (const f of fields) {
    const raw = getPath(details, f.path);
    if (f.kind === "list") vals[f.path] = Array.isArray(raw) ? raw.join(", ") : "";
    else if (f.kind === "rows")
      vals[f.path] = (Array.isArray(raw) ? raw : []).map((r: any) => Object.fromEntries(f.cols.map((c) => [c.key, r?.[c.key] ?? ""])));
    else if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}T/.test(raw)) vals[f.path] = raw.slice(0, 10); // ISO date -> yyyy-mm-dd
    else vals[f.path] = raw ?? "";
  }
  return vals;
}

// form text -> properly typed values for the API
function toDetails(fields: Field[], vals: Record<string, any>): Record<string, any> {
  const d: Record<string, any> = {};
  for (const f of fields) {
    const v = vals[f.path];
    if (f.kind === "list") setPath(d, f.path, String(v).split(",").map((s) => s.trim()).filter(Boolean));
    else if (f.kind === "rows")
      setPath(d, f.path, (v as Record<string, string>[])
        .filter((r) => Object.values(r).some((x) => String(x).trim() !== ""))
        .map((r) => Object.fromEntries(f.cols.map((c) => [c.key, c.number ? Number(r[c.key]) : r[c.key]]))));
    else if (f.kind === "number") { if (v !== "") setPath(d, f.path, Number(v)); }
    else if (String(v).trim() !== "") setPath(d, f.path, String(v).trim());
  }
  return d;
}

export default function ArtifactForm({
  evidenceId, evidenceType, initial, canEdit,
}: {
  evidenceId: number;
  evidenceType: string;
  initial: { tags?: string[]; findings?: { severity: string; summary: string }[]; details?: any; extracted_at?: string } | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const fields = SPECS[evidenceType] ?? [];
  const [vals, setVals] = useState(() => toForm(fields, initial?.details ?? {}));
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [findings, setFindings] = useState<{ severity: string; summary: string }[]>(initial?.findings ?? []);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const setVal = (path: string, v: any) => { setVals((p) => ({ ...p, [path]: v })); setSaved(false); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    const res = await callApi("PUT", `/api/evidence/${evidenceId}/artifacts`, {
      tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
      findings: findings.filter((f) => f.summary.trim()),
      details: toDetails(fields, vals),
    });
    setBusy(false);
    if (res.error) return setError(res.error);
    setSaved(true);
    router.refresh();
  }

  if (fields.length === 0) return <ErrorBox message={`No artifact form is defined for type "${evidenceType}".`} />;

  return (
    <form onSubmit={submit} className="space-y-5">
      {!initial && <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">No artifact metadata recorded yet for this evidence.</p>}
      {!canEdit && <p className="rounded bg-slate-100 p-2 text-sm text-slate-600">Read-only: your role cannot edit artifacts.</p>}

      <fieldset disabled={!canEdit || busy} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.filter((f) => f.kind !== "rows").map((f) => (
            <label key={f.path} className="block text-sm font-medium">
              {f.label}
              {f.kind === "select" ? (
                <select value={vals[f.path]} onChange={(e) => setVal(f.path, e.target.value)} className={`${inputCls} mt-1`}>
                  <option value="">Select…</option>
                  {f.options.map((o) => <option key={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type={f.kind === "number" ? "number" : "text"}
                  min={f.kind === "number" ? 0 : undefined}
                  value={vals[f.path]}
                  onChange={(e) => setVal(f.path, e.target.value)}
                  placeholder={f.kind === "list" ? f.hint : undefined}
                  className={`${inputCls} mt-1`}
                />
              )}
            </label>
          ))}
        </div>

        {fields.filter((f): f is Extract<Field, { kind: "rows" }> => f.kind === "rows").map((f) => (
          <div key={f.path}>
            <p className="mb-1 text-sm font-medium">{f.label}</p>
            {(vals[f.path] as Record<string, string>[]).map((row, i) => (
              <div key={i} className="mb-2 flex gap-2">
                {f.cols.map((c) => (
                  <input key={c.key} placeholder={c.label} type={c.number ? "number" : "text"} value={row[c.key]} className={inputCls}
                    onChange={(e) => setVal(f.path, (vals[f.path] as any[]).map((r, j) => (j === i ? { ...r, [c.key]: e.target.value } : r)))} />
                ))}
                <button type="button" className={btnGhostCls} onClick={() => setVal(f.path, (vals[f.path] as any[]).filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button type="button" className={btnGhostCls}
              onClick={() => setVal(f.path, [...(vals[f.path] as any[]), Object.fromEntries(f.cols.map((c) => [c.key, ""]))])}>
              + Add row
            </button>
          </div>
        ))}

        <label className="block text-sm font-medium">
          Tags (comma separated)
          <input value={tags} onChange={(e) => { setTags(e.target.value); setSaved(false); }} className={`${inputCls} mt-1`} placeholder="malware, insider-threat" />
        </label>

        <div>
          <p className="mb-1 text-sm font-medium">Findings</p>
          {findings.map((f, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <select value={f.severity} className={`${inputCls} max-w-[9rem]`}
                onChange={(e) => setFindings(findings.map((x, j) => (j === i ? { ...x, severity: e.target.value } : x)))}>
                {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
              </select>
              <input value={f.summary} placeholder="Summary (min 3 characters)" className={inputCls}
                onChange={(e) => setFindings(findings.map((x, j) => (j === i ? { ...x, summary: e.target.value } : x)))} />
              <button type="button" className={btnGhostCls} onClick={() => setFindings(findings.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button type="button" className={btnGhostCls} onClick={() => setFindings([...findings, { severity: "MEDIUM", summary: "" }])}>+ Add finding</button>
        </div>
      </fieldset>

      {error && <ErrorBox message={error} />}
      {saved && <p className="text-sm text-green-700">Saved.</p>}
      {canEdit && <button disabled={busy} className={btnCls}>{busy ? "Saving…" : "Save artifacts"}</button>}
    </form>
  );
}
