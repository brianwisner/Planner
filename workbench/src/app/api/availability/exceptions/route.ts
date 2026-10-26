import { z } from "zod";
import { db } from "@/lib/db";
import { availabilityExceptions } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ApiError, ok, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";

export const POST = route(async (req) => {
  const user = await requireUser();
  await assertSameOrigin();
  const body = await parseBody(
    req,
    z.object({
      userId: z.number().int().optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      kind: z.enum(["off", "custom"]),
      startMinute: z.number().int().min(0).max(1440).nullable().optional(),
      endMinute: z.number().int().min(0).max(1440).nullable().optional(),
      breakMinutes: z.number().int().min(0).max(600).nullable().optional(),
      note: z.string().max(200).nullable().optional(),
    }),
  );
  const userId = body.userId ?? user.id;
  if (userId !== user.id && user.role !== "owner") throw new ApiError("You can only edit your own hours", 403);
  const [row] = await db
    .insert(availabilityExceptions)
    .values({ ...body, userId })
    .onConflictDoUpdate({ target: [availabilityExceptions.userId, availabilityExceptions.date], set: { kind: body.kind, startMinute: body.startMinute ?? null, endMinute: body.endMinute ?? null, breakMinutes: body.breakMinutes ?? null, note: body.note ?? null } })
    .returning();
  await audit(user.id, "availability.exception", "user", userId, `${body.kind === "off" ? "Day off" : "Custom hours"} on ${body.date}`);
  return ok({ exception: row }, { status: 201 });
});
