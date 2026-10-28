import { z } from "zod";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, parse, handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");

const auditQuery = z.object({
  table: z.string().trim().min(1).max(50).optional(),
  target_id: z.coerce.number().int().positive().optional(),
  action: z.enum(["INSERT", "UPDATE", "DELETE", "TRANSFER", "LOGIN"]).optional(),
  user: z.coerce.number().int().positive().optional(),
  from: day.optional(),
  to: day.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

// GET /api/audit -> who did what, when (ADMIN only)
// DBMS concepts: audit trail filled by TRIGGERS (append-only table), LEFT JOIN to users
//                (user_id can be NULL), index idx_audit_target on (target_table, target_id),
//                date-range filter, role-based access.
export async function GET(req: Request) {
  try {
    await requireRole(["ADMIN"]);
    const raw = Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v !== ""));
    const q = parse(auditQuery, raw);

    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q.table) { where.push("a.target_table = ?"); params.push(q.table); }
    if (q.target_id) { where.push("a.target_id = ?"); params.push(q.target_id); }
    if (q.action) { where.push("a.action = ?"); params.push(q.action); }
    if (q.user) { where.push("a.user_id = ?"); params.push(q.user); }
    if (q.from) { where.push("a.created_at >= ?"); params.push(q.from); }
    // "to" is inclusive of the whole day: created_at < to + 1 day
    if (q.to) { where.push("a.created_at < DATE_ADD(?, INTERVAL 1 DAY)"); params.push(q.to); }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [{ total }] = await query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM audit_logs a ${whereSql}`,
      params
    );
    const limit = q.pageSize;                   // integers validated by zod, so safe to inline
    const offset = (q.page - 1) * q.pageSize;
    const items = await query(
      `SELECT a.id, a.target_table, a.target_id, a.action, a.created_at, a.user_id, u.full_name AS user_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ${whereSql}
       ORDER BY a.id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return ok({ items, page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) });
  } catch (e) {
    return handleError(e);
  }
}
