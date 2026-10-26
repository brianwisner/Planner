import { z } from "zod";
import { db } from "@/lib/db";
import { correspondence } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";

export const POST = route(async (req) => {
  const user = await requireUser();
  await assertSameOrigin();
  const body = await parseBody(
    req,
    z.object({
      clientId: z.number().int().nullable().optional(),
      projectId: z.number().int().nullable().optional(),
      kind: z.enum(["note", "email", "call", "meeting"]).default("note"),
      subject: z.string().max(500).nullable().optional(),
      body: z.string().max(20000).nullable().optional(),
      occurredAt: z.string().datetime({ offset: true }).optional(),
      linkUrl: z.string().url().nullable().optional(),
      gmailMessageId: z.string().nullable().optional(),
      gmailThreadId: z.string().nullable().optional(),
    }),
  );
  if (!body.clientId && !body.projectId) throw new ApiError("A client or project is required", 422);
  const [row] = await db
    .insert(correspondence)
    .values({ ...body, occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(), createdBy: user.id })
    .returning();
  await audit(user.id, "correspondence.create", body.projectId ? "project" : "client", body.projectId ?? body.clientId!, `Added ${body.kind}: ${body.subject ?? ""}`.trim());
  return ok({ item: row }, { status: 201 });
});
