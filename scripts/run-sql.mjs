// Rebuilds the MySQL schema by feeding every db/sql/*.sql file (in filename order)
// to the real `mysql` CLI inside the Docker container. The CLI understands
// "DELIMITER $$" natively, so triggers/procedures need no special handling.
//
//   npm run db:init     -> run all files (fails if tables already exist)
//   npm run db:reset    -> DROP + CREATE the database first, then run all files
//
// Equivalent manual command for one file (what this script does per file):
//   docker exec -i -e MYSQL_PWD=<app password> shadowtrace-mysql \
//       mysql -u<app user> <database> < db/sql/00_core.sql
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const { MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE, MYSQL_ROOT_PASSWORD } = process.env;
const CONTAINER = "shadowtrace-mysql";

function mysqlCli(user, password, args, stdin) {
  // MYSQL_PWD env var keeps the password off the command line.
  const r = spawnSync("docker", ["exec", "-i", "-e", `MYSQL_PWD=${password}`, CONTAINER, "mysql", `-u${user}`, ...args], {
    input: stdin,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (r.status !== 0) {
    console.error("FAILED");
    process.exit(r.status ?? 1);
  }
}

if (process.argv.includes("--reset")) {
  console.log("Dropping and recreating", MYSQL_DATABASE);
  // Root is needed only here; the app user cannot drop/create databases.
  mysqlCli("root", MYSQL_ROOT_PASSWORD, [], `DROP DATABASE IF EXISTS ${MYSQL_DATABASE}; CREATE DATABASE ${MYSQL_DATABASE} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL ON ${MYSQL_DATABASE}.* TO '${MYSQL_USER}'@'%';`);
}

import { readFileSync } from "node:fs";
const files = readdirSync("db/sql").filter((f) => f.endsWith(".sql")).sort();
for (const f of files) {
  if (f.startsWith("99_")) continue; // ALTER/DROP demo is run by hand during the viva
  console.log("running", f);
  mysqlCli(MYSQL_USER, MYSQL_PASSWORD, [MYSQL_DATABASE], readFileSync(`db/sql/${f}`));
}
console.log("done");
