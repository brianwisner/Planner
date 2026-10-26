import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectDependencies } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, idParam, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";

export const PUT = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  await assertSameOrigin();
  const projectId = await idParam(ctx);
  const { dependsOn } = await parseBody(req, z.object({ dependsOn: z.array(z.number().int()) }));
  if (dependsOn.includes(projectId)) throw new ApiError("A project cannot depend on itself", 422);
  await db.transaction(async (tx) => {
    await tx.delete(projectDependencies).where(eq(projectDependencies.projectId, projectId));
    if (dependsOn.length) await tx.insert(projectDependencies).values(dependsOn.map((d) => ({ projectId, dependsOnId: d })));
  });
  await audit(user.id, "project.dependencies", "project", projectId, `Set dependencies: ${dependsOn.join(", ") || "none"}`);
  return ok({ dependsOn });
});
