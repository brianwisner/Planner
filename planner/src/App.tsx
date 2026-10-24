import { useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { DataProvider, useData } from './lib/store'
import { EditorProvider } from './components/editors'
import { ConfirmProvider } from './components/ui'
import { Shell } from './components/Shell'
import { BrandMark } from './components/Brand'
import { Login, SetPassword } from './pages/Login'
import { Today } from './pages/Today'
import { Jobs } from './pages/Jobs'
import { JobMoneyRedirect, JobPage } from './pages/JobPage'
import { Schedule } from './pages/Schedule'
import { Time } from './pages/Time'
import { Money } from './pages/Money'

import { InvoiceView } from './pages/InvoiceView'
import { SiteVisitPage } from './pages/SiteVisitPage'
import { SiteVisitReport } from './pages/SiteVisitReport'
import { PlanCheckLetter } from './pages/PlanCheckLetter'
import { Clients } from './pages/Clients'
import { ClientPage } from './pages/ClientPage'
import { Settings } from './pages/Settings'
import { useReminders } from './lib/reminders'

// Invite and password-reset emails send people here with "type=…" in the address.
const arrivedVia = /type=(invite|recovery|signup|magiclink)/.exec(window.location.hash)?.[1] ?? null

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [needsPassword, setNeedsPassword] = useState(arrivedVia === 'invite' || arrivedVia === 'recovery')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setNeedsPassword(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <Splash />
  if (!session) return <Login />
  if (needsPassword) return <SetPassword onDone={() => { setNeedsPassword(false); window.location.hash = '' }} />

  return <DataProvider session={session}>
    <HashRouter>
      <ConfirmProvider>
        <EditorProvider>
          <Shell>
            <Loaded>
              <Routes>
                <Route path="/" element={<Today />} />
                <Route path="/jobs" element={<Jobs />} />
                <Route path="/jobs/:id" element={<JobPage />} />
                <Route path="/jobs/:id/visits/:visitId" element={<SiteVisitPage />} />
                <Route path="/jobs/:id/visits/:visitId/report" element={<SiteVisitReport />} />
                <Route path="/jobs/:id/plan-check/:roundId" element={<PlanCheckLetter />} />
                <Route path="/schedule" element={<Schedule />} />
                <Route path="/time" element={<Time />} />
                <Route path="/money" element={<Money />} />
                <Route path="/money/job/:id" element={<JobMoneyRedirect />} />
                <Route path="/money/invoice/:id" element={<InvoiceView />} />
                <Route path="/clients" element={<Clients />} />
                <Route path="/clients/:id" element={<ClientPage />} />
                <Route path="/settings" element={<Settings />} />
                {/* Addresses from the previous version keep working. */}
                <Route path="/billing" element={<LegacyBilling />} />
                <Route path="/calendar" element={<Navigate to="/schedule?view=month" replace />} />
                <Route path="/reports" element={<Navigate to="/money?tab=reports" replace />} />
                <Route path="/availability" element={<Navigate to="/schedule" replace />} />
                <Route path="/review" element={<Navigate to="/" replace />} />
                <Route path="/follow-ups" element={<Navigate to="/" replace />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Loaded>
          </Shell>
        </EditorProvider>
      </ConfirmProvider>
    </HashRouter>
  </DataProvider>
}

function Splash({ text = 'Loading…' }: { text?: string }) {
  return <div className="loading-screen"><BrandMark /><div className="spinner" /><span className="small">{text}</span></div>
}

function Loaded({ children }: { children: React.ReactNode }) {
  const { loading, error, refresh } = useData()
  useReminders()
  if (loading) return <div className="loading-screen" style={{ minHeight: '60vh' }}><div className="spinner" /><span className="small">Loading your jobs…</span></div>
  if (error) return <div className="card card-pad" style={{ marginTop: 24 }}>
    <h2>Could not load your data</h2>
    <p className="small danger-text mt">{error}</p>
    <p className="small muted mt">Check your internet connection and try again. If this keeps happening, the database may need attention (see planner/README.md).</p>
    <button className="btn primary mt" onClick={() => void refresh()}>Try again</button>
  </div>
  return <>{children}</>
}

function LegacyBilling() {
  const [params] = useSearchParams()
  const job = params.get('job'), tab = params.get('tab')
  if (job) return <Navigate to={`/jobs/${job}?tab=billing`} replace />
  if (tab === 'hours') return <Navigate to="/time" replace />
  return <Navigate to={tab === 'deposits' || tab === 'invoices' ? `/money?tab=${tab}` : '/money'} replace />
}

function NotFound() {
  const { pathname } = useLocation()
  return <div className="card card-pad" style={{ marginTop: 24 }}>
    <h2>Page not found</h2>
    <p className="small muted mt">There's nothing at “{pathname}”.</p>
    <a className="btn primary mt" href="#/">Go to Today</a>
  </div>
}
