import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
  var __pgClient: ReturnType<typeof postgres> | undefined;
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// Reuse a single connection pool across hot reloads in development.
const client = global.__pgClient ?? postgres(url, { max: 10, prepare: false, onnotice: () => {} });
if (process.env.NODE_ENV !== "production") global.__pgClient = client;

export const db = drizzle(client, { schema });
export type Db = typeof db;
export { schema };
