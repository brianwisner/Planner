export type MatchClient = { id: number; name: string; company: string | null; email: string | null; contactEmails: string[] };
export type MatchProject = { id: number; clientId: number; name: string; address: string | null };
export type MatchMessage = { fromAddress: string | null; fromName: string | null; subject: string | null; snippet: string | null };

const PUBLIC_DOMAINS = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "me.com", "live.com", "msn.com", "comcast.net"]);
const KEYWORDS = ["structural", "engineer", "beam", "foundation", "permit", "retaining", "deck", "remodel", "addition", "seismic", "framing", "header", "footing", "truss", "calculation", "calcs", "stamp", "inspection", "load", "shear", "wall", "plans", "drawings", "proposal", "estimate", "quote", "bid", "project", "site visit", "adu", "garage", "roof", "joist", "post", "pier"];

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase();
const domainOf = (email: string | null) => {
  const m = /@([^>\s]+)/.exec(email ?? "");
  return m ? m[1].toLowerCase() : null;
};

/** Scores a message against clients/projects. Pure and deterministic; email text is treated as data only. */
export function matchMessage(msg: MatchMessage, clients: MatchClient[], projects: MatchProject[]) {
  const from = norm(msg.fromAddress);
  const text = `${norm(msg.subject)} ${norm(msg.snippet)}`;
  const fromName = norm(msg.fromName);
  let best: { clientId: number | null; projectId: number | null; score: number; reasons: string[] } = { clientId: null, projectId: null, score: 0, reasons: [] };

  for (const c of clients) {
    let score = 0;
    const reasons: string[] = [];
    const emails = [c.email, ...c.contactEmails].filter(Boolean).map((e) => norm(e));
    if (from && emails.some((e) => e && from.includes(e))) {
      score += 60;
      reasons.push(`Sender matches client ${c.name}`);
    } else {
      const d = domainOf(msg.fromAddress);
      if (d && !PUBLIC_DOMAINS.has(d) && emails.some((e) => e.endsWith("@" + d))) {
        score += 35;
        reasons.push(`Sender domain matches ${c.name}`);
      }
    }
    const cname = norm(c.name);
    const lastName = cname.split(" ").pop() ?? "";
    if (cname.length > 3 && (text.includes(cname) || fromName.includes(cname))) {
      score += 25;
      reasons.push(`Mentions ${c.name}`);
    } else if (lastName.length > 3 && (fromName.includes(lastName) || text.includes(lastName))) {
      score += 12;
      reasons.push(`Mentions "${lastName}"`);
    }
    const company = norm(c.company);
    if (company.length > 3 && (text.includes(company) || fromName.includes(company))) {
      score += 20;
      reasons.push(`Mentions ${c.company}`);
    }
    let projectId: number | null = null;
    for (const p of projects.filter((p) => p.clientId === c.id)) {
      const pname = norm(p.name);
      const addr = norm(p.address);
      const street = addr.split(",")[0]?.trim();
      if ((pname.length > 4 && text.includes(pname)) || (street && street.length > 5 && text.includes(street))) {
        score += 25;
        reasons.push(`Mentions project ${p.name}`);
        projectId = p.id;
        break;
      }
    }
    if (score > best.score) best = { clientId: c.id, projectId, score, reasons };
  }
  // Generic relevance when no client matches: engineering keywords in subject/snippet.
  const kw = KEYWORDS.filter((k) => text.includes(k));
  if (kw.length) {
    best.score += Math.min(20, kw.length * 5);
    best.reasons.push(`Keywords: ${kw.slice(0, 4).join(", ")}`);
  }
  return best;
}
