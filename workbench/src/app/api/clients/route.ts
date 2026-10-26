import { z } from "zod";
import { db } from "@/lib/db";
import { clients, contacts } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { listClients } from "@/lib/services/clients";
import { zText } from "@/lib/services/common";

export const clientSchema = z.object({
  name: z.string().min(1).max(200),
  company: zText,
  email: z.string().email().nullable().optional().or(z.literal("")),
  phone: zText,
  address: zText,
  kind: z.enum(["homeowner", "contractor", "architect", "developer", "agency", "other"]).optional(),
  notes: zText,
  status: z.enum(["active", "archived"]).optional(),
});

export const GET = route(async (req) => {
  await requireUser();
  const url = new URL(req.url);
  return ok({ clients: await listClients({ q: url.searchParams.get("q") ?? undefined, status: url.searchParams.get("status") ?? "active" }) });
});

export const POST = route(async (req) => {
  const user = await requireUser();
  await assertSameOrigin();
  const body = await parseBody(req, clientSchema.extend({ primaryContact: z.object({ name: z.string(), email: z.string().optional(), phone: z.string().optional() }).optional() }));
  const { primaryContact, ...data } = body;
  const [row] = await db
    .insert(clients)
    .values({ ...data, email: data.email || null, updatedBy: user.id })
    .returning();
  if (primaryContact?.name) {
    await db.insert(contacts).values({ clientId: row.id, name: primaryContact.name, email: primaryContact.email || null, phone: primaryContact.phone || null, isPrimary: true });
  }
  await audit(user.id, "client.create", "client", row.id, `Created client ${row.name}`);
  return ok({ client: row }, { status: 201 });
});
