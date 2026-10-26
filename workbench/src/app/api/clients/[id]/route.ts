import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, ConflictError, idParam, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getClientFull } from "@/lib/services/clients";
import { clean } from "@/lib/services/common";
import { clientSchema } from "../route";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req, ctx: Ctx) => {
  await requireUser();
  const id = await idParam(ctx);
  const client = await getClientFull(id);
  if (!client) throw new ApiError("Client not found", 404);
  return ok({ client });
});

export const PATCH = route(async (req, ctx: Ctx) => {
  const user = await requireUser();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const body = await parseBody(req, clientSchema.partial().extend({ version: z.number().int() }));
  const { version, ...changes } = body;
  const data = clean({ ...changes, email: changes.email === "" ? null : changes.email });
  const [row] = await db
    .update(clients)
    .set({ ...data, version: sql`${clients.version} + 1`, updatedAt: new Date(), updatedBy: user.id })
    .where(and(eq(clients.id, id), eq(clients.version, version)))
    .returning();
  if (!row) {
    const [current] = await db.select().from(clients).where(eq(clients.id, id));
    if (!current) throw new ApiError("Client not found", 404);
    throw new ConflictError(current);
  }
  await audit(user.id, "client.update", "client", id, `Updated client ${row.name}`, { fields: Object.keys(data) });
  return ok({ client: row });
});
