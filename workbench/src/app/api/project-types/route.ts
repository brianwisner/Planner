import { z } from "zod";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectTypes } from "@/lib/db/schema";
import { assertSameOrigin, requireOwner, requireUser } from "@/lib/auth/session";
import { ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { numStr, zNum } from "@/lib/services/common";

export const projectTypeSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  defaultScope: z.string().max(10000).nullable().optional(),
  defaultTasks: z.array(z.object({ name: z.string().min(1), phase: z.string().optional(), hours: z.number().min(0) })).optional(),
  defaultFeeType: z.enum(["hourly", "fixed"]).optional(),
  defaultFee: zNum,
  defaultHours: zNum,
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const GET = route(async () => {
  await requireUser();
  return ok({ projectTypes: await db.select().from(projectTypes).orderBy(asc(projectTypes.sortOrder), asc(projectTypes.name)) });
});

export const POST = route(async (req) => {
  const user = await requireOwner();
  await assertSameOrigin();
  const body = await parseBody(req, projectTypeSchema);
  const [row] = await db.insert(projectTypes).values({ ...body, defaultFee: numStr(body.defaultFee), defaultHours: numStr(body.defaultHours) }).returning();
  await audit(user.id, "project_type.create", "project_type", row.id, `Created project type ${row.name}`);
  return ok({ projectType: row }, { status: 201 });
});
