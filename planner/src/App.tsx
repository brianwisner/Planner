import { useEffect, useState } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { DataProvider, useData } from './lib/store'
import { Layout } from './components/Layout'
import { Login, SetPassword } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Jobs } from './pages/Jobs'
import { JobDetail } from './pages/JobDetail'
import { Clients } from './pages/Clients'
import { ClientDetail } from './pages/ClientDetail'
import { CalendarPage } from './pages/CalendarPage'
import { Time } from './pages/Time'
import { Billing } from './pages/Billing'
import { Reports } from './pages/Reports'
import { Settings } from './pages/Settings'

// When someone clicks an invite or password-reset email, Supabase sends them
// here with "type=invite" or "type=recovery" in the address. We remember that
// so we can show the "choose a password" screen once they are signed in.
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

  if (session === undefined) return <div className="empty">Loading…</div>
  if (!session) return <Login />
  if (needsPassword) return <SetPassword onDone={() => { setNeedsPassword(false); window.location.hash = '' }} />

  return (
    <DataProvider session={session}>
      <HashRouter>
        <Layout>
          <Loaded>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/jobs" element={<Jobs />} />
              <Route path="/jobs/:id" element={<JobDetail />} />
              <Route path="/clients" element={<Clients />} />
              <Route path="/clients/:id" element={<ClientDetail />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/time" element={<Time />} />
              <Route path="/billing" element={<Billing />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Dashboard />} />
            </Routes>
          </Loaded>
        </Layout>
      </HashRouter>
    </DataProvider>
  )
}

function Loaded({ children }: { children: React.ReactNode }) {
  const { loading, error } = useData()
  if (loading) return <div className="empty">Loading your jobs…</div>
  if (error) return <div className="card"><h2>Could not load data</h2><p className="danger-text">{error}</p><p className="small muted">Most likely the database setup SQL has not been run yet. See the README, step 2.</p></div>
  return <>{children}</>
}
