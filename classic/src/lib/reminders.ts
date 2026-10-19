// Due-date reminders: once a day (per device) show a browser notification for
// any business deadline that is overdue or due today. Also exposes a helper to
// ask for permission from Settings.
import { useEffect } from 'react'
import { useData } from './store'
import { calendarItems } from './calendar'
import { todayISO } from './utils'

export function useReminders() {
  const store = useData()
  const { me } = store
  useEffect(() => {
    if (!me || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const key = `reminded-${me.id}-${todayISO()}`
    try { if (localStorage.getItem(key)) return } catch { return }
    const today = todayISO()
    const mine = calendarItems(store).filter(i => !i.done && i.date <= today)
    if (mine.length === 0) return
    const overdue = mine.filter(i => i.date < today).length
    const dueToday = mine.length - overdue
    const body = [overdue ? `${overdue} overdue` : '', dueToday ? `${dueToday} due today` : ''].filter(Boolean).join(' · ')
    try {
      new Notification('Wisner Planner reminders', { body: `${body}. ${mine[0]!.title}${mine.length > 1 ? ` and ${mine.length - 1} more` : ''}` })
      localStorage.setItem(key, '1')
    } catch { /* notifications unsupported in this context */ }
  }, [me, store])
}

export async function enableNotifications(): Promise<string> {
  if (typeof Notification === 'undefined') return 'This browser does not support notifications. On iPhone, add the app to your Home Screen first.'
  const r = await Notification.requestPermission()
  return r === 'granted' ? 'Reminders are on. You will get one notification per day with anything overdue or due today.' : 'Notifications were not allowed.'
}
