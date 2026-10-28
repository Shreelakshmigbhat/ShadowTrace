import { z } from "zod";
import { withTransaction } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, fail, parse, readJson, handleError } from "@/lib/api";

const body = z.object({
  status: z.enum(["COLLECTED", "IN_ANALYSIS", "IN_STORAGE", "RELEASED", "DESTROYED"]),
});

// PATCH /api/evidence/:id/status
// DBMS concepts: transaction + SELECT ... FOR UPDATE (read-then-write without a race),
//                AFTER UPDATE audit trigger records WHO changed it (@app_user_id),
//                CHECK constraint chk_ev_status as the final guard.
// Rule: RELEASED and DESTROYED are final (transfer_custody also refuses them).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole(["INVESTIGATOR", "ADMIN"]);
    const id = parse(z.coerce.number().int().positive(), params.id);
    const { status } = parse(body, await readJson(req));

    const row = await withTransaction(session.userId, async (conn) => {
      // Lock the row so nobody changes the status between our check and our UPDATE.
      const [found] = await conn.execute("SELECT status FROM evidence WHERE id = ? FOR UPDATE", [id]);
      const current = (found as any[])[0];
      if (!current) throw fail("Evidence not found", 404);
      if (current.status === "RELEASED" || current.status === "DESTROYED")
        throw fail(`Status is final (${current.status}) and cannot be changed`, 409);

      await conn.execute("UPDATE evidence SET status = ? WHERE id = ?", [status, id]);
      const [rows] = await conn.execute("SELECT * FROM v_evidence_current WHERE id = ?", [id]);
      return (rows as any[])[0];
    });

    return ok(row);
  } catch (e) {
    return handleError(e); // a thrown Response from inside the transaction also passes through here
  }
}
