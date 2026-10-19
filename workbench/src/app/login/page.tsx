export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  if (count === 0) redirect("/setup");
  const user = await getCurrentUser();
  const { next } = await searchParams;
  if (user) redirect(next && next.startsWith("/") ? next : "/today");
  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="card w-full max-w-sm">
        <div className="mb-5">
          <div className="text-xs uppercase tracking-wide muted">Wisner Engineering, LLC</div>
          <h1 className="h1">Workbench</h1>
        </div>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
