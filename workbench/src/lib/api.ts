import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AuthError } from "@/lib/auth/session";

export class ApiError extends Error {
  status: number;
  extra?: unknown;
  constructor(message: string, status = 400, extra?: unknown) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** 409 with the current server copy so the client can show what changed. */
export class ConflictError extends ApiError {
  constructor(current: unknown) {
    super("This record was changed by someone else since you loaded it. Review the latest version and try again.", 409, { current });
  }
}

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function handleError(e: unknown) {
  if (e instanceof AuthError || e instanceof ApiError) {
    const extra = e instanceof ApiError ? e.extra : undefined;
    return NextResponse.json({ error: e.message, ...(extra && typeof extra === "object" ? extra : {}) }, { status: e.status });
  }
  if (e instanceof ZodError) {
    const issues = e.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`);
    return NextResponse.json({ error: issues.join("; "), issues }, { status: 422 });
  }
  const msg = e instanceof Error ? e.message : "Unexpected error";
  // Database-level duplicate (e.g. second running timer) surfaces as 409.
  if (/duplicate key|unique/i.test(msg)) return NextResponse.json({ error: "Duplicate record: " + msg }, { status: 409 });
  console.error(e);
  return NextResponse.json({ error: "Something went wrong on the server." }, { status: 500 });
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new ApiError("Request body must be JSON", 400);
  }
  return schema.parse(json);
}

/** Wraps a route handler with error handling. */
export function route<Ctx>(fn: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      return handleError(e);
    }
  };
}

export async function idParam(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError("Invalid id", 400);
  return n;
}
