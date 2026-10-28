import { z } from "zod";
import { pool, query } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, parse, readJson, handleError } from "@/lib/api";

const body = z.object({
  evidence_id: z.coerce.number().int().positive(),
  to_user_id: z.coerce.number().int().positive(),
  reason: z.string().trim().min(5, "reason must be at least 5 characters").max(255),
  // Only an ADMIN may hand over on behalf of someone else; everyone else always acts as themselves.
  from_user_id: z.coerce.number().int().positive().optional(),
});

// POST /api/transfers -> hand custody to another user
// DBMS concepts: STORED PROCEDURE with its own transaction, row lock (SELECT ... FOR UPDATE) inside it,
//                SIGNAL SQLSTATE '45000' business rules -> friendly 400s, audit triggers via @app_user_id.
//
// NOT wrapped in withTransaction(): the procedure runs START TRANSACTION itself, and in MySQL a
// START TRANSACTION inside an open transaction silently COMMITS the outer one. So we use one
// plain pooled connection: SET @app_user_id, then CALL.
export async function POST(req: Request) {
  try {
    const session = await requireRole(["ADMIN", "INVESTIGATOR", "ANALYST"]);
    const b = parse(body, await readJson(req));
    const fromUser = session.role === "ADMIN" && b.from_user_id ? b.from_user_id : session.userId;

    const conn = await pool.getConnection();
    try {
      await conn.execute("SET @app_user_id = ?", [session.userId]);
      await conn.execute("CALL transfer_custody(?, ?, ?, ?)", [b.evidence_id, fromUser, b.to_user_id, b.reason]);
    } finally {
      // Pooled connections are reused: clear the variable so the next request can never inherit this user.
      await conn.query("SET @app_user_id = NULL").catch(() => {});
      conn.release();
    }

    const [evidence] = await query("SELECT * FROM v_evidence_current WHERE id = ?", [b.evidence_id]);
    const [transfer] = await query(
      "SELECT * FROM v_chain_of_custody WHERE evidence_id = ? ORDER BY transfer_seq DESC LIMIT 1",
      [b.evidence_id]
    );
    return ok({ evidence, transfer }, 201);
  } catch (e) {
    return handleError(e); // 45000 messages from the procedure become 400 { error: "..." }
  }
}
