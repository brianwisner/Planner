// Email buttons open a new message in Gmail on the web, not the computer's
// default mail app (the owner uses Gmail, and the default app may be something else).
import { useData } from './store'

const GOOGLE_MAIL = /@(gmail|googlemail)\.com$/i

/** A Gmail "new message" address. `account` picks which signed-in Google account sends it. */
export function gmailLink(to: string, opts: { subject?: string; body?: string; account?: string | null } = {}): string {
  const params: [string, string | undefined][] = [
    ['authuser', opts.account && GOOGLE_MAIL.test(opts.account) ? opts.account : undefined],
    ['view', 'cm'], ['fs', '1'],
    ['to', to.trim() || undefined], ['su', opts.subject], ['body', opts.body],
  ]
  const query = params.filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&')
  return `https://mail.google.com/mail/?${query}`
}

/** Builds Gmail links sent from the signed-in owner's Gmail account. */
export function useEmailLink() {
  const { me, session } = useData()
  const account = me?.email || session?.user.email || null
  return (to: string, subject?: string, body?: string) => gmailLink(to, { subject, body, account })
}

/** Link props for an email button: opens Gmail in a new tab. */
export const EMAIL_TARGET = { target: '_blank', rel: 'noreferrer', title: 'Opens a new message in Gmail' } as const
