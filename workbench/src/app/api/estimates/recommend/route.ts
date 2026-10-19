import { requireUser } from "@/lib/auth/session";
import { ApiError, ok, route } from "@/lib/api";
import { recommendForProject } from "@/lib/services/estimates";

export const GET = route(async (req) => {
  await requireUser();
  const projectId = Number(new URL(req.url).searchParams.get("projectId"));
  if (!projectId) throw new ApiError("projectId is required", 400);
  const recommendation = await recommendForProject(projectId);
  if (!recommendation) throw new ApiError("Project not found", 404);
  return ok({ recommendation });
});
