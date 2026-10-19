import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ok, route } from "@/lib/api";

export const GET = route(async () => {
  await db.execute(sql`select 1`);
  return ok({ ok: true, time: new Date().toISOString() });
});
