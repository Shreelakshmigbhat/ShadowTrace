# ShadowTrace - Digital Evidence Forensics System

DBMS mini project. MySQL 8 (relational, integrity-critical data) + MongoDB 7 (variable-shape artifact metadata and case notes), served by Next.js 14 (App Router, TypeScript, Tailwind).

## Quick start
```bash
npm install
cp .env.example .env.local     # then fill in passwords and JWT_SECRET
npm run db:up                  # start MySQL + MongoDB in Docker
npm run db:init                # run every db/sql/*.sql file in order
npm run dev                    # http://localhost:3000
```
`npm run db:reset` drops and recreates the database, then re-runs all SQL files.
Docker Desktop must be running.

## Folder ownership
| Path | Owner |
|---|---|
| db/sql/00_core, 02_links, 10_core_advanced, 90_seed_core | Member B |
| db/sql/01_evidence, 11_evidence_advanced, 91_seed_evidence | Member A |
| db/sql/99_alter_drop_demo | either |
| app/(core), app/api/{auth,users,investigations,assets,dashboard} | Member B |
| app/(evidence), app/api/{evidence,transfers,audit} | Member A |
| lib/db.ts, lib/mongo.ts, lib/auth.ts | shared (auth internals: Member B) |

## Naming rules (both members)
1. SQL tables and columns: `snake_case`, tables plural (`evidence_transfers`), FK columns `<thing>_id`.
2. Status / enum values stored in UPPERCASE (`COLLECTED`, `IN_ANALYSIS`, `CRITICAL`).
3. API responses are always `{ "data": ... }` on success or `{ "error": "message" }` on failure, with a correct HTTP status.
4. SQL is always parameterised (`?`); never build SQL by string concatenation.
5. Mutations that touch several rows use `withTransaction(userId, ...)` so audit triggers see `@app_user_id`.
6. Mongo documents carry `evidence_id` or `investigation_id` (numbers from MySQL).
7. SQL file prefixes: 0x = tables, 1x = advanced (views/procedures/triggers), 9x = seed data.

## Auth stub
`lib/auth.ts` currently reads `DEV_USER_ID` / `DEV_ROLE` from `.env.local`. Member B replaces the internals later; `getSession()` and `requireRole()` signatures stay the same.
