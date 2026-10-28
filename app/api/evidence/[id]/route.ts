import { z } from "zod";
import { query } from "@/lib/db";
import { getDb } from "@/lib/mongo";
import { requireRole } from "@/lib/auth";
import { ok, fail, parse, handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

const idParam = z.coerce.number().int().positive();

// GET /api/evidence/:id -> one evidence item from THREE places:
//   1. MySQL view v_evidence_current   (the record)
//   2. MySQL view v_chain_of_custody   (every transfer, numbered with ROW_NUMBER())
//   3. MongoDB evidence_artifacts      (type-specific forensic metadata, or null if none yet)
// DBMS concepts: views, window function (inside the view), polyglot persistence (SQL + NoSQL joined by evidence_id).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole(["ADMIN", "INVESTIGATOR", "ANALYST"]);
    const id = parse(idParam, params.id);

    const [evidence] = await query("SELECT * FROM v_evidence_current WHERE id = ?", [id]);
    if (!evidence) return fail("Evidence not found", 404);

    const chain = await query(
      "SELECT * FROM v_chain_of_custody WHERE evidence_id = ? ORDER BY transfer_seq",
      [id]
    );

    // A MongoDB outage should not hide the SQL record, so degrade to null instead of failing.
    let artifact = null;
    try {
      const db = await getDb();
      artifact = await db.collection("evidence_artifacts").findOne({ evidence_id: id }, { projection: { _id: 0 } });
    } catch (err) {
      console.error("Mongo unavailable:", err);
    }

    return ok({ evidence, chain, artifact });
  } catch (e) {
    return handleError(e);
  }
}
