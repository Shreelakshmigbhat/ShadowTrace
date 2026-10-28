import mysql from "mysql2/promise";

// One shared pool for the whole app. Next.js dev mode reloads modules, so the pool is
// cached on globalThis to avoid opening a new pool on every reload.
const g = globalThis as unknown as { mysqlPool?: mysql.Pool };

export const pool: mysql.Pool =
  g.mysqlPool ??
  mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectionLimit: 10,
  });
g.mysqlPool = pool;

// Runs ONE statement with "?" placeholders (parameterised -> no SQL injection).
export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const [rows] = await pool.execute(sql, params);
  return rows as T[];
}

// Runs a unit of work as one transaction on one connection:
//   START TRANSACTION -> SET @app_user_id -> work() -> COMMIT  (or ROLLBACK on any error)
// Triggers read @app_user_id to record WHO made each change in audit_logs.
export async function withTransaction<T>(
  userId: number,
  work: (conn: mysql.PoolConnection) => Promise<T>
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.query("START TRANSACTION");
    await conn.query("SET @app_user_id = ?", [userId]);
    const result = await work(conn);
    await conn.query("COMMIT");
    return result;
  } catch (err) {
    await conn.query("ROLLBACK"); // also undoes everything if a trigger raised SIGNAL
    throw err;
  } finally {
    conn.release(); // always return the connection to the pool
  }
}
