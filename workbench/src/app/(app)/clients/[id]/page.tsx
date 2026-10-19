import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getClientFull } from "@/lib/services/clients";
import { PageHeader } from "@/components/ui/PageHeader";
import { ClientDetail } from "@/components/clients/ClientDetail";
import { StatusBadge } from "@/components/ui/Badges";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const client = await getClientFull(Number(id));
  if (!client) notFound();
  return (
    <div>
      <PageHeader title={client.name} subtitle={<span>{client.company ?? ""} {client.status === "archived" && <StatusBadge status="archived" />}</span>} back={<Link href="/clients" className="link">← Clients</Link>} />
      <ClientDetail client={client} />
    </div>
  );
}
