import { z } from "zod";
import { query, withTransaction } from "@/lib/db";
import { getDb } from "@/lib/mongo";
import { requireRole } from "@/lib/auth";
import { ok, fail, parse, readJson, handleError } from "@/lib/api";

const body = z.object({
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  findings: z
    .array(z.object({
      severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
      summary: z.string().trim().min(3).max(500),
    }))
    .max(100)
    .default([]),
  // Shape depends on the evidence type, so zod only checks "it is an object".
  // MongoDB's $jsonSchema validator checks the per-type required fields (imei, partitions, ...).
  details: z.record(z.string(), z.unknown()),
});

// PUT /api/evidence/:id/artifacts -> create or replace the forensic metadata document
// DBMS concepts: MongoDB upsert (updateOne + upsert:true), $jsonSchema validation (error 121 -> 400),
//                unique index on evidence_id, cross-database consistency (evidence must exist in MySQL),
//                MySQL audit row written for the MongoDB change so it is still traceable.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole(["ANALYST", "INVESTIGATOR"]);
    const id = parse(z.coerce.number().int().positive(), params.id);
    const b = parse(body, await readJson(req));

    // Mongo cannot enforce a foreign key, so check MySQL ourselves. The type comes from MySQL, never from the client.
    const [ev] = await query<{ type_name: string }>("SELECT type_name FROM v_evidence_current WHERE id = ?", [id]);
    if (!ev) return fail("Evidence not found", 404);

    const doc = {
      evidence_type: ev.type_name,
      extracted_by: session.userId,
      extracted_at: new Date(),
      tags: b.tags,
      findings: b.findings,
      details: b.details,
    };

    const db = await getDb();
    await db.collection("evidence_artifacts").updateOne(
      { evidence_id: id },
      { $set: doc, $setOnInsert: { evidence_id: id } },
      { upsert: true }
    );

    // Record the change in the MySQL audit log (append-only), inside a transaction with @app_user_id set.
    await withTransaction(session.userId, (conn) =>
      conn.execute(
        "INSERT INTO audit_logs (target_table, target_id, action, user_id) VALUES ('evidence_artifacts', ?, 'UPDATE', ?)",
        [id, session.userId]
      )
    );

    const saved = await db.collection("evidence_artifacts").findOne({ evidence_id: id }, { projection: { _id: 0 } });
    return ok(saved);
  } catch (e) {
    return handleError(e);
  }
}
