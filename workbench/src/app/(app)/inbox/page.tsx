import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getAccount, googleConfigured, hasScope, SCOPES } from "@/lib/google/client";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/Notice";
import { InboxList } from "@/components/inbox/InboxList";
import { listClients } from "@/lib/services/clients";
import { listProjects } from "@/lib/services/projects";

export const metadata = { title: "Inbox" };

export default async function InboxPage() {
  const user = await requireUser();
  const account = await getAccount(user.id);
  const gmail = hasScope(account, SCOPES.gmail[0]) && account?.status !== "disconnected";
  if (!gmail) {
    return (
      <div>
        <PageHeader title="Inbox" subtitle="Client requests and project correspondence from Gmail, with suggested links." />
        <EmptyState title={googleConfigured() ? "Gmail is not connected." : "Google integration is not configured yet."} action={<Link href="/settings/google" className="btn btn-primary">Open Google settings</Link>}>
          {googleConfigured()
            ? "Connect Gmail (read-only) to see recent messages here with suggested client and project links. The app never sends, deletes, archives, or relabels mail."
            : "Add the Google OAuth credentials to the server configuration (see docs/DEPLOYMENT.md), then connect Gmail from Settings → Google."}
        </EmptyState>
      </div>
    );
  }
  const [clients, projects] = await Promise.all([listClients({ status: "active" }), listProjects({})]);
  return (
    <div>
      <PageHeader title="Inbox" subtitle={`Read-only view of ${account?.googleEmail}. Suggestions are hints; nothing is linked until you confirm.`} />
      <InboxList clients={clients.map((c) => ({ id: c.id, name: c.name }))} projects={projects.map((p) => ({ id: p.id, name: p.name, clientId: p.clientId }))} lastScan={account?.gmailLastScanAt?.toISOString() ?? null} lastError={account?.gmailLastError ?? null} />
    </div>
  );
}
