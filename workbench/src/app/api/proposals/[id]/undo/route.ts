import { assertSameOrigin, requireOwner } from "@/lib/auth/session";
import { ApiError, idParam, ok, route } from "@/lib/api";
import { undoProposal } from "@/lib/services/schedule";

export const POST = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireOwner();
  await assertSameOrigin();
  const id = await idParam(ctx);
  try {
    return ok(await undoProposal(id, user.id));
  } catch (e) {
    throw new ApiError((e as Error).message, 422);
  }
});
