import Link from "next/link";
import { asc } from "drizzle-orm";
import { requireOwner } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { billingRates } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/PageHeader";
import { RatesEditor } from "@/components/settings/RatesEditor";

export const metadata = { title: "Billing rates" };

export default async function RatesPage() {
  await requireOwner();
  const rates = await db.select().from(billingRates).orderBy(asc(billingRates.id));
  return (
    <div>
      <PageHeader title="Billing rates" subtitle="Used as defaults in estimates. The default rate also prices hour-based recommendations." back={<Link href="/settings" className="link">← Settings</Link>} />
      <RatesEditor rates={rates} />
    </div>
  );
}
