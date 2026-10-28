// ===========================================================================
// AUTH CONTRACT  (shared by Member A and Member B)
//
// This file is a STUB. It trusts DEV_USER_ID / DEV_ROLE from .env.local so pages
// and APIs can be built before login exists.
//
// Member B: replace the INTERNALS of getSession() with real JWT-cookie logic
// (jose + bcrypt). DO NOT change the exported names or signatures below.
// ===========================================================================

export type Role = "ADMIN" | "INVESTIGATOR" | "ANALYST";
export type Session = { userId: number; role: Role };

const ROLES: Role[] = ["ADMIN", "INVESTIGATOR", "ANALYST"];

// Returns the current user, or null if nobody is logged in.
export async function getSession(): Promise<Session | null> {
  const userId = Number(process.env.DEV_USER_ID);
  const role = process.env.DEV_ROLE as Role;
  if (!userId || !ROLES.includes(role)) return null;
  return { userId, role };
}

// Use at the top of a route handler:  const s = await requireRole(["ADMIN"]);
// Throws a Response (401 not logged in / 403 wrong role). Catch it with `asResponse`.
export async function requireRole(roles: Role[]): Promise<Session> {
  const session = await getSession();
  if (!session) throw Response.json({ error: "Not logged in" }, { status: 401 });
  if (!roles.includes(session.role)) throw Response.json({ error: "Forbidden" }, { status: 403 });
  return session;
}

// Helper so route handlers can do:  catch (e) { return asResponse(e); }
export function asResponse(e: unknown): Response {
  if (e instanceof Response) return e;
  console.error(e);
  return Response.json({ error: "Server error" }, { status: 500 });
}
