import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, idParam, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { contactSchema } from "../../clients/[id]/contacts/route";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req, ctx: Ctx) => {
  const user = await requireUser();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const body = await parseBody(req, contactSchema.partial());
  const [row] = await db.update(contacts).set(body).where(eq(contacts.id, id)).returning();
  if (!row) throw new ApiError("Contact not found", 404);
  await audit(user.id, "contact.update", "client", row.clientId, `Updated contact ${row.name}`);
  return ok({ contact: row });
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const user = await requireUser();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const [row] = await db.delete(contacts).where(eq(contacts.id, id)).returning();
  if (!row) throw new ApiError("Contact not found", 404);
  await audit(user.id, "contact.delete", "client", row.clientId, `Removed contact ${row.name}`);
  return ok({ ok: true });
});
