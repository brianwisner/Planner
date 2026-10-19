"use client";

export class ClientApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super((body?.error as string) || `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

/** JSON fetch helper. Throws ClientApiError with status; network failures throw with status 0. */
export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ClientApiError(0, { error: "You appear to be offline. This change was not saved to the server." });
  }
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }
  if (!res.ok) throw new ClientApiError(res.status, body);
  return body as T;
}
