import { query } from "@/lib/db";
import { getDb } from "@/lib/mongo";
import { requireRole } from "@/lib/auth";
import { ok, handleError } from "@/lib/api";
import { highSeverityByType, topTags, topMobileApps } from "@/db/mongo/evidence_artifacts.pipelines";

export const dynamic = "force-dynamic";

// GET /api/evidence/stats -> dashboard numbers for the evidence module.
// DBMS concepts: GROUP BY + HAVING, aggregates (COUNT/SUM/AVG/MAX), LEFT JOIN anti-join,
//                CTE + window function LAG(), conditional aggregation,
//                MongoDB aggregation pipelines ($unwind, $group, $sort).
// (SUM/AVG are CAST because mysql2 returns DECIMAL as a string.)
export async function GET() {
  try {
    await requireRole(["ADMIN", "INVESTIGATOR", "ANALYST"]);

    const [byStatus, statusByType, custodiansOver3, neverTransferred, mostTransferred, avgGap] = await Promise.all([
      query(`SELECT status, COUNT(*) AS count FROM evidence GROUP BY status ORDER BY count DESC`),

      query(`SELECT t.type_name, COUNT(e.id) AS total,
                    CAST(SUM(e.status = 'COLLECTED') AS UNSIGNED)   AS collected,
                    CAST(SUM(e.status = 'IN_ANALYSIS') AS UNSIGNED) AS in_analysis,
                    CAST(SUM(e.status = 'IN_STORAGE') AS UNSIGNED)  AS in_storage,
                    CAST(SUM(e.status IN ('RELEASED','DESTROYED')) AS UNSIGNED) AS closed_out
             FROM evidence_types t
             LEFT JOIN evidence e ON e.evidence_type_id = t.id
             GROUP BY t.id, t.type_name
             ORDER BY total DESC`),

      // GROUP BY + HAVING: custodians holding more than 3 items
      query(`SELECT u.id, u.full_name, COUNT(*) AS items_held
             FROM evidence e JOIN users u ON u.id = e.custodian_id
             GROUP BY u.id, u.full_name
             HAVING COUNT(*) > ?
             ORDER BY items_held DESC`, [3]),

      // LEFT JOIN ... IS NULL: evidence never transferred
      query(`SELECT e.id, e.file_name, e.status, u.full_name AS custodian
             FROM evidence e
             LEFT JOIN evidence_transfers tr ON tr.evidence_id = e.id
             JOIN users u ON u.id = e.custodian_id
             WHERE tr.id IS NULL
             ORDER BY e.id`),

      query(`SELECT e.id, e.file_name, COUNT(tr.id) AS transfer_count, MAX(tr.transferred_at) AS last_transfer
             FROM evidence e JOIN evidence_transfers tr ON tr.evidence_id = e.id
             GROUP BY e.id, e.file_name
             ORDER BY transfer_count DESC, last_transfer DESC
             LIMIT 5`),

      // CTE + LAG(): hours between consecutive custody events, averaged per evidence type
      query(`WITH gaps AS (
               SELECT e.evidence_type_id,
                      TIMESTAMPDIFF(HOUR,
                        LAG(tr.transferred_at, 1, e.collected_at) OVER (PARTITION BY tr.evidence_id ORDER BY tr.transferred_at),
                        tr.transferred_at) AS hours_gap
               FROM evidence_transfers tr JOIN evidence e ON e.id = tr.evidence_id)
             SELECT t.type_name, COUNT(*) AS transfers, CAST(ROUND(AVG(g.hours_gap), 1) AS DOUBLE) AS avg_hours_between
             FROM gaps g JOIN evidence_types t ON t.id = g.evidence_type_id
             GROUP BY t.id, t.type_name
             ORDER BY avg_hours_between DESC`),
    ]);

    // MongoDB part: if Mongo is down the SQL statistics are still returned.
    let mongo: Record<string, unknown> | null = null;
    try {
      const col = (await getDb()).collection("evidence_artifacts");
      const [highSeverity, tags, mobileApps] = await Promise.all([
        col.aggregate([...highSeverityByType]).toArray(),
        col.aggregate([...topTags]).toArray(),
        col.aggregate([...topMobileApps]).toArray(),
      ]);
      mongo = { highSeverityByType: highSeverity, topTags: tags, topMobileApps: mobileApps };
    } catch (err) {
      console.error("Mongo unavailable:", err);
    }

    return ok({ sql: { byStatus, statusByType, custodiansOver3, neverTransferred, mostTransferred, avgGap }, mongo });
  } catch (e) {
    return handleError(e);
  }
}
