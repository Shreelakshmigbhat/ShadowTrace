// evidence_artifacts.pipelines.ts (Member A)
// Three aggregation pipelines. The arrays are exported so API routes can reuse them;
// running this file directly prints the result of each:  npm run mongo:pipelines
import { MongoClient } from "mongodb";
import { pathToFileURL } from "node:url";

// 1. High-severity findings per evidence type.
//    $unwind turns each element of findings[] into its own document, $match keeps HIGH/CRITICAL,
//    $group counts them per evidence_type, $sort puts the worst type first.
//    (MySQL equivalent would need a findings table, a JOIN and a GROUP BY.)
export const highSeverityByType = [
  { $unwind: "$findings" },
  { $match: { "findings.severity": { $in: ["HIGH", "CRITICAL"] } } },
  { $group: { _id: "$evidence_type", high_findings: { $sum: 1 }, evidence_items: { $addToSet: "$evidence_id" } } },
  { $project: { _id: 0, evidence_type: "$_id", high_findings: 1, evidence_items: { $size: "$evidence_items" } } },
  { $sort: { high_findings: -1 } },
];

// 2. Most frequent tags across all evidence (top 10).
export const topTags = [
  { $unwind: "$tags" },
  { $group: { _id: "$tags", uses: { $sum: 1 } } },
  { $sort: { uses: -1, _id: 1 } },   // _id ascending breaks ties alphabetically
  { $limit: 10 },
  { $project: { _id: 0, tag: "$_id", uses: 1 } },
];

// 3. Most common installed apps on mobile devices.
//    $match first so only mobile documents are unwound (cheaper, and uses idx_evidence_type).
export const topMobileApps = [
  { $match: { evidence_type: "Mobile Device" } },
  { $unwind: "$details.installed_apps" },
  { $group: { _id: "$details.installed_apps", devices: { $sum: 1 } } },
  { $sort: { devices: -1, _id: 1 } },
  { $project: { _id: 0, app: "$_id", devices: 1 } },
];

// ---- runner: only when executed directly, not when imported ----
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = new MongoClient(process.env.MONGODB_URI!);
  try {
    const col = client.db(process.env.MONGODB_DB).collection("evidence_artifacts");
    for (const [title, pipeline] of [
      ["High-severity findings per evidence type", highSeverityByType],
      ["Most frequent tags", topTags],
      ["Most common installed apps (mobile)", topMobileApps],
    ] as const) {
      console.log(`\n== ${title}`);
      console.table(await col.aggregate([...pipeline]).toArray());
    }
  } finally {
    await client.close();
  }
}
