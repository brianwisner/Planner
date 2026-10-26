export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { SetupForm } from "./SetupForm";

export const metadata = { title: "First-time setup" };

export default async function SetupPage() {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  if (count > 0) redirect("/login");
  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="card w-full max-w-md">
        <div className="text-xs uppercase tracking-wide muted">Wisner Engineering, LLC</div>
        <h1 className="h1 mb-1">Set up Workbench</h1>
        <p className="text-sm muted mb-5">
          Create the owner account. This page only works once, while the database has no users. You can add Erika afterwards in Settings → Users.
        </p>
        <SetupForm />
      </div>
    </main>
  );
}
