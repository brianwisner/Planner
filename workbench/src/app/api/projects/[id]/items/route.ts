import { z } from "zod";
import { db } from "@/lib/db";
import { projectItems } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { idParam, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { numStr, zNum } from "@/lib/services/common";

export const itemSchema = z.object({
  kind: z.enum(["waiting", "blocker", "scope_change"]),
  description: z.string().min(1).max(5000),
  hoursAdded: zNum,
  feeAdded: zNum,
  blocksScheduling: z.boolean().optional(),
});

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  await assertSameOrigin();
  const projectId = await idParam(ctx);
  const body = await parseBody(req, itemSchema);
  const [row] = await db
    .insert(projectItems)
    .values({ ...body, projectId, hoursAdded: numStr(body.hoursAdded), feeAdded: numStr(body.feeAdded), blocksScheduling: body.blocksScheduling ?? body.kind === "blocker", createdBy: user.id })
    .returning();
  await audit(user.id, `item.create`, "project", projectId, `Added ${body.kind.replace("_", " ")}: ${body.description.slice(0, 80)}`);
  return ok({ item: row }, { status: 201 });
});
