import { request } from "@playwright/test";
import { execSync } from "node:child_process";
import { BRIAN, ERIKA } from "./helpers";

export default async function globalSetup() {
  const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";
  const db = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/workbench";
  // Fresh database for every run: truncate all app tables (migrations table kept).
  execSync(
    `psql "${db}" -q -c "DO \\$\\$ DECLARE r record; BEGIN FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '__drizzle_migrations') LOOP EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE'; END LOOP; END \\$\\$;"`,
    { stdio: "inherit" },
  );
  const ctx = await request.newContext({ baseURL: base });
  const s = await ctx.post("/api/auth/setup", { data: { name: BRIAN.name, email: BRIAN.email, password: BRIAN.password } });
  if (!s.ok()) throw new Error(`setup failed: ${s.status()} ${await s.text()}`);
  const u = await ctx.post("/api/users", { data: { name: ERIKA.name, email: ERIKA.email, password: ERIKA.password, role: "staff" } });
  if (!u.ok()) throw new Error(`create staff failed: ${await u.text()}`);
  await ctx.dispose();
}
