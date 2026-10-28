import { z } from "zod";
import type { ResultSetHeader } from "mysql2/promise";
import { query, withTransaction } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ok, parse, readJson, handleError, toSqlDateTime } from "@/lib/api";

export const dynamic = "force-dynamic"; // never cache: data changes constantly

const STATUSES = ["COLLECTED", "IN_ANALYSIS", "IN_STORAGE", "RELEASED", "DESTROYED"] as const;

// ORDER BY cannot use "?" placeholders, so the client only chooses a KEY from this whitelist
// and we map it to a column we wrote ourselves. User text never reaches the SQL string.
const SORT_COLUMNS = {
  id: "id",
  file_name: "file_name",
  status: "status",
  type: "type_name",
  custodian: "custodian_name",
  collected_at: "collected_at",
} as const;

const listQuery = z.object({
  status: z.enum(STATUSES).optional(),
  type: z.string().trim().min(1).max(50).optional(), // type name, e.g. "Disk Image"
  custodian: z.coerce.number().int().positive().optional(),
  search: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(Object.keys(SORT_COLUMNS) as [keyof typeof SORT_COLUMNS, ...(keyof typeof SORT_COLUMNS)[]]).default("collected_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

// GET /api/evidence  -> filtered, sorted, paginated list from the view v_evidence_current
// DBMS concepts: VIEW (joins hidden behind v_evidence_current), parameterised WHERE, LIKE search,
//                ORDER BY whitelist, LIMIT/OFFSET pagination, COUNT(*) for the total.
export async function GET(req: Request) {
  try {
    await requireRole(["ADMIN", "INVESTIGATOR", "ANALYST"]);

    // Ignore empty query-string values (?status=) instead of failing validation.
    const raw = Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v !== ""));
    const q = parse(listQuery, raw);

    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q.status) { where.push("status = ?"); params.push(q.status); }
    if (q.type) { where.push("type_name = ?"); params.push(q.type); }
    if (q.custodian) { where.push("custodian_id = ?"); params.push(q.custodian); }
    if (q.search) {
      // escape LIKE wildcards typed by the user so "50%" searches for a literal percent sign
      where.push("file_name LIKE ?");
      params.push(`%${q.search.replace(/[\\%_]/g, "\\$&")}%`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [{ total }] = await query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM v_evidence_current ${whereSql}`,
      params
    );

    // LIMIT/OFFSET are inlined: they are integers already checked by zod (min/max above),
    // and mysql2's prepared statements reject "?" in LIMIT on MySQL 8.
    const limit = q.pageSize;
    const offset = (q.page - 1) * q.pageSize;
    const items = await query(
      `SELECT * FROM v_evidence_current ${whereSql}
       ORDER BY ${SORT_COLUMNS[q.sort]} ${q.order === "asc" ? "ASC" : "DESC"}, id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return ok({ items, page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) });
  } catch (e) {
    return handleError(e);
  }
}

const createBody = z.object({
  file_name: z.string().trim().min(1).max(255),
  // The browser computes SHA-256 (crypto.subtle) and sends 64 hex chars. We lowercase it, then
  // validate again here; the database CHECK + UNIQUE are the last line of defence.
  file_hash: z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/, "must be 64 hex characters (SHA-256)"),
  evidence_type_id: z.coerce.number().int().positive(),
  collected_at: z.coerce.date().optional(), // omitted -> current time
});

// POST /api/evidence -> register new evidence; the creator becomes collector AND first custodian
// DBMS concepts: transaction (withTransaction), AFTER INSERT audit trigger (via @app_user_id),
//                CHECK + UNIQUE + FOREIGN KEY errors mapped to friendly messages,
//                BEFORE INSERT trigger (collected_at not in the future).
export async function POST(req: Request) {
  try {
    const session = await requireRole(["INVESTIGATOR", "ADMIN"]);
    const body = parse(createBody, await readJson(req));

    const row = await withTransaction(session.userId, async (conn) => {
      const [res] = await conn.execute<ResultSetHeader>(
        `INSERT INTO evidence (file_hash, file_name, collected_at, evidence_type_id, collected_by, custodian_id)
         VALUES (?, ?, COALESCE(?, NOW()), ?, ?, ?)`,
        [
          body.file_hash,
          body.file_name,
          body.collected_at ? toSqlDateTime(body.collected_at) : null,
          body.evidence_type_id,
          session.userId,
          session.userId,
        ]
      );
      const [rows] = await conn.execute("SELECT * FROM v_evidence_current WHERE id = ?", [res.insertId]);
      return (rows as any[])[0];
    });

    return ok(row, 201);
  } catch (e) {
    return handleError(e);
  }
}
