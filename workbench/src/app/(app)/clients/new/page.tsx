import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { ClientForm } from "@/components/clients/ClientForm";

export const metadata = { title: "New client" };

export default async function NewClientPage({ searchParams }: { searchParams: Promise<{ name?: string; email?: string; contact?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  return (
    <div className="max-w-2xl">
      <PageHeader title="New client" back={<Link href="/clients" className="link">← Clients</Link>} />
      <div className="card">
        <ClientForm initial={{ name: sp.name ?? "" }} prefill={{ email: sp.email, contactName: sp.contact }} />
      </div>
    </div>
  );
}
