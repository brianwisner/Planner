// Email buttons open a new message in Gmail on the web, not the computer's
// default mail app (the owner uses Gmail, and the default app may be something else).
import { useData } from './store'
import { DEMO } from './supabase'

const EMAIL_ADDRESS = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i

/** Checks an email address after trimming surrounding spaces. */
export function isEmailAddress(email: string): boolean {
  return EMAIL_ADDRESS.test(email.trim())
}

/** A Gmail "new message" address. `account` picks which signed-in Google account sends it. */
export function gmailLink(to: string, opts: { subject?: string; body?: string; account?: string | null } = {}): string {
  const account = opts.account?.trim()
  const params: [string, string | undefined][] = [
    ['authuser', account && isEmailAddress(account) ? account : undefined],
    ['view', 'cm'], ['fs', '1'],
    ['to', to.trim() || undefined], ['su', opts.subject], ['body', opts.body],
  ]
  const query = params.filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&')
  return `https://mail.google.com/mail/?${query}`
}

/** Builds Gmail links using the business email, or the owner's login when no business email is saved. */
export function useEmailLink() {
  const { settings, me, session } = useData()
  const account = DEMO ? null : settings.business_email?.trim() || me?.email || session?.user.email || null
  return (to: string, subject?: string, body?: string) => gmailLink(to, { subject, body, account })
}

/** Link props for an email button: opens Gmail in a new tab. */
export const EMAIL_TARGET = { target: '_blank', rel: 'noreferrer', title: 'Opens a new message in Gmail' } as const
