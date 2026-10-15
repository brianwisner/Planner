import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { googleAccounts } from "@/lib/db/schema";
import { assertSameOrigin, requireUser } from "@/lib/auth/session";
import { ok, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { authorizedClient } from "@/lib/google/client";
import { decrypt } from "@/lib/crypto";

export const POST = route(async () => {
  const user = await requireUser();
  await assertSameOrigin();
  const [a] = await db.select().from(googleAccounts).where(eq(googleAccounts.userId, user.id));
  if (a?.refreshTokenEnc) {
    try {
      const { client } = await authorizedClient(user.id);
      await client.revokeToken(decrypt(a.refreshTokenEnc));
    } catch {
      /* token may already be invalid */
    }
  }
  if (a) await db.delete(googleAccounts).where(eq(googleAccounts.id, a.id)); // cascades calendars, events, inbox cache
  await audit(user.id, "google.disconnect", "user", user.id, "Disconnected Google account");
  return ok({ ok: true });
});
