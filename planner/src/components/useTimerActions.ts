// Stop a timer from any button. A timer that ran all night opens the hours
// form instead of saving, so a forgotten timer never bills 20 hours by itself.
import { useCallback } from 'react'
import { useData } from '../lib/store'
import { elapsedHours, needsReview, stopTimer } from '../lib/timer'
import type { TimeEntry } from '../lib/types'
import { fmtHours } from '../lib/utils'
import { useEditors } from './editors'

export function useStopTimer() {
  const store = useData()
  const edit = useEditors()
  return useCallback(async (entry: TimeEntry) => {
    if (needsReview(entry)) {
      store.toast(`This timer ran ${fmtHours(elapsedHours(entry))}. Enter the hours you actually worked, then save.`, 'error')
      edit.time(entry, { hours: null })
      return false
    }
    return stopTimer(store, entry)
  }, [store, edit])
}
