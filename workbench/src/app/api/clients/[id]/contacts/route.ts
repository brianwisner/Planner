import { z } from "zod";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { idParam, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";

export const contactSchema = z.object({
  name: z.string().min(1).max(200),
  role: z.string().max(100).nullable().optional(),
  email: z.string().max(200).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  isPrimary: z.boolean().optional(),
});

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  await assertSameOrigin();
  const clientId = await idParam(ctx);
  const body = await parseBody(req, contactSchema);
  const [row] = await db.insert(contacts).values({ ...body, clientId }).returning();
  await audit(user.id, "contact.create", "client", clientId, `Added contact ${row.name}`);
  return ok({ contact: row }, { status: 201 });
});
