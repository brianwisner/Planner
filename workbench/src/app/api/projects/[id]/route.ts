import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, ConflictError, idParam, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getProjectFull } from "@/lib/services/projects";
import { clean } from "@/lib/services/common";
import { projectSchema, toProjectRow } from "../route";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req, ctx: Ctx) => {
  await requireUser();
  const id = await idParam(ctx);
  const project = await getProjectFull(id);
  if (!project) throw new ApiError("Project not found", 404);
  return ok({ project });
});

export const PATCH = route(async (req, ctx: Ctx) => {
  const user = await requireUser();
  await assertSameOrigin();
  const id = await idParam(ctx);
  const body = await parseBody(req, projectSchema.partial().extend({ version: z.number().int() }));
  const { version, ...changes } = body;
  const data = clean(toProjectRow(changes));
  // Status transitions keep acceptance and start dates honest without forcing extra typing.
  const today = new Date().toISOString().slice(0, 10);
  if (changes.status === "accepted" && changes.acceptanceDate === undefined) {
    data.acceptanceDate = sql`coalesce(${projects.acceptanceDate}, ${today})`;
  }
  if (changes.status === "in_progress" && changes.actualStart === undefined) {
    data.actualStart = sql`coalesce(${projects.actualStart}, ${today})`;
    data.acceptanceDate = sql`coalesce(${projects.acceptanceDate}, ${today})`;
  }
  if (changes.status === "completed" && changes.actualCompletion === undefined) {
    data.actualCompletion = sql`coalesce(${projects.actualCompletion}, ${today})`;
    if (changes.remainingHours === undefined) data.remainingHours = "0";
  }
  const [row] = await db
    .update(projects)
    .set({ ...(data as Record<string, unknown>), version: sql`${projects.version} + 1`, updatedAt: new Date(), updatedBy: user.id })
    .where(and(eq(projects.id, id), eq(projects.version, version)))
    .returning();
  if (!row) {
    const [current] = await db.select().from(projects).where(eq(projects.id, id));
    if (!current) throw new ApiError("Project not found", 404);
    throw new ConflictError(current);
  }
  const important = ["status", "priority", "clientDueDate", "targetCompletion", "estimatedHours", "remainingHours", "feeAmount", "feeType", "tentativeReserve"];
  const changedImportant = Object.keys(changes).filter((k) => important.includes(k));
  await audit(
    user.id,
    "project.update",
    "project",
    id,
    changedImportant.length ? `Updated ${changedImportant.map((k) => `${k} → ${String((changes as Record<string, unknown>)[k])}`).join(", ")}` : `Updated project details`,
    { fields: Object.keys(changes) },
  );
  return ok({ project: row });
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const user = await requireUser();
  if (user.role !== "owner") throw new ApiError("Only the owner can delete projects", 403);
  await assertSameOrigin();
  const id = await idParam(ctx);
  const [row] = await db.delete(projects).where(eq(projects.id, id)).returning();
  if (!row) throw new ApiError("Project not found", 404);
  await audit(user.id, "project.delete", "project", id, `Deleted project ${row.name}`);
  return ok({ ok: true });
});
