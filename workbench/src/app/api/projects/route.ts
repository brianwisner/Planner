import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { PROJECT_STATUSES, projectTypes, projects, tasks } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { listProjects } from "@/lib/services/projects";
import { numStr, zDate, zNum, zText } from "@/lib/services/common";

export const projectSchema = z.object({
  clientId: z.number().int(),
  name: z.string().min(1).max(200),
  address: zText,
  projectTypeId: z.number().int().nullable().optional(),
  scope: zText,
  complexity: z.enum(["low", "medium", "high"]).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  priority: z.number().int().min(1).max(4).optional(),
  tentativeReserve: z.boolean().optional(),
  inquiryDate: zDate,
  acceptanceDate: zDate,
  plannedStart: zDate,
  actualStart: zDate,
  targetCompletion: zDate,
  clientDueDate: zDate,
  actualCompletion: zDate,
  estimatedHours: zNum,
  remainingHours: zNum,
  feeType: z.enum(["hourly", "fixed"]).nullable().optional(),
  feeAmount: zNum,
  hourlyRate: zNum,
  notes: zText,
  links: z.array(z.object({ label: z.string().max(200), url: z.string().max(2000) })).optional(),
});

export function toProjectRow(b: Partial<z.infer<typeof projectSchema>>) {
  const out: Record<string, unknown> = { ...b };
  for (const k of ["estimatedHours", "remainingHours", "feeAmount", "hourlyRate"] as const) {
    if (k in b) out[k] = numStr(b[k]);
  }
  return out;
}

export const GET = route(async (req) => {
  await requireUser();
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const clientId = url.searchParams.get("clientId");
  return ok({
    projects: await listProjects({
      status: status && status !== "all" ? status.split(",") : undefined,
      clientId: clientId ? Number(clientId) : undefined,
      q: url.searchParams.get("q") ?? undefined,
    }),
  });
});

export const POST = route(async (req) => {
  const user = await requireUser();
  await assertSameOrigin();
  const body = await parseBody(req, projectSchema.extend({ applyTemplate: z.boolean().optional() }));
  const { applyTemplate, ...data } = body;
  const row = await db.transaction(async (tx) => {
    const values = toProjectRow(data) as typeof projects.$inferInsert;
    // Apply template defaults from the project type when asked (default: yes).
    if (data.projectTypeId && applyTemplate !== false) {
      const [t] = await tx.select().from(projectTypes).where(eq(projectTypes.id, data.projectTypeId));
      if (t) {
        if (!values.scope && t.defaultScope) values.scope = t.defaultScope;
        if (values.estimatedHours == null && t.defaultHours) values.estimatedHours = t.defaultHours;
        if (!values.feeType) values.feeType = t.defaultFeeType;
        if (values.feeAmount == null && t.defaultFee) values.feeAmount = t.defaultFee;
      }
    }
    if (!values.inquiryDate) values.inquiryDate = new Date().toISOString().slice(0, 10);
    const [p] = await tx.insert(projects).values({ ...values, updatedBy: user.id }).returning();
    if (data.projectTypeId && applyTemplate !== false) {
      const [t] = await tx.select().from(projectTypes).where(eq(projectTypes.id, data.projectTypeId));
      if (t?.defaultTasks?.length) {
        await tx.insert(tasks).values(
          t.defaultTasks.map((tt, i) => ({ projectId: p.id, name: tt.name, phase: tt.phase ?? null, estimatedHours: String(tt.hours), remainingHours: String(tt.hours), sortOrder: i })),
        );
      }
    }
    return p;
  });
  await audit(user.id, "project.create", "project", row.id, `Created project ${row.name}`);
  return ok({ project: row }, { status: 201 });
});
