import { describe, expect, it } from 'vitest'
import { jobStage, stageChanges, STAGES, type Stage } from './stages'
import type { Phase, PhaseStatus } from './types'

const kinds = ['bidding', 'design', 'plan_check', 'construction', 'client_changes'] as const
function phases(statuses: PhaseStatus[], jobId = 'j1'): Phase[] {
  return kinds.map((kind, i) => ({
    id: `${jobId}-${kind}`, job_id: jobId, kind, name: kind, sort_order: i + 1, status: statuses[i] ?? 'not_started',
    estimate_hours: 0, start_date: null, due_date: null, assignee_id: null, notes: '',
  }))
}
const apply = (list: Phase[], target: Stage) => {
  const changes = stageChanges(list, 'j1', target)
  return list.map(p => { const c = changes.find(x => x.id === p.id); return c ? { ...p, status: c.to } : p })
}

describe('jobStage', () => {
  it('starts new jobs in bidding', () => {
    expect(jobStage(phases([]), 'j1')).toMatchObject({ stage: 'bidding', state: 'not_started' })
  })
  it('puts a won job with design not started in "ready"', () => {
    expect(jobStage(phases(['complete']), 'j1')).toMatchObject({ stage: 'ready', state: 'not_started' })
  })
  it('uses the most advanced started phase', () => {
    expect(jobStage(phases(['complete', 'in_progress', 'waiting']), 'j1')).toMatchObject({ stage: 'plan_check', state: 'waiting' })
  })
  it('treats client changes as side work, not a stage', () => {
    const s = jobStage(phases(['complete', 'in_progress', 'not_started', 'not_started', 'in_progress']), 'j1')
    expect(s.stage).toBe('design')
    expect(s.clientChanges?.kind).toBe('client_changes')
  })
  it('waits in the next column once a phase is complete', () => {
    expect(jobStage(phases(['complete', 'complete']), 'j1')).toMatchObject({ stage: 'plan_check', state: 'not_started' })
  })
  it('reports when every main phase is done', () => {
    expect(jobStage(phases(['complete', 'complete', 'complete', 'complete']), 'j1')).toMatchObject({ stage: 'construction', state: 'done', allDone: true })
  })
  it('ignores retired queued phases', () => {
    const list = [...phases(['complete']), { ...phases([])[0], id: 'q', kind: 'queued' as const, status: 'in_progress' as const }]
    expect(jobStage(list, 'j1').stage).toBe('ready')
  })
})

describe('stageChanges', () => {
  it('moves forward: earlier phases complete, target started', () => {
    const next = apply(phases(['in_progress']), 'plan_check')
    expect(next.map(p => p.status)).toEqual(['complete', 'complete', 'in_progress', 'not_started', 'not_started'])
  })
  it('moves back: later started phases reset, completed history kept', () => {
    const next = apply(phases(['complete', 'complete', 'complete', 'in_progress']), 'design')
    expect(next.map(p => p.status)).toEqual(['complete', 'in_progress', 'complete', 'not_started', 'not_started'])
  })
  it('keeps a waiting phase waiting when it is already the target', () => {
    expect(stageChanges(phases(['complete', 'waiting']), 'j1', 'design')).toEqual([])
  })
  it('never touches client changes', () => {
    const next = apply(phases(['complete', 'in_progress', 'not_started', 'not_started', 'in_progress']), 'construction')
    expect(next[4].status).toBe('in_progress')
  })
  it.each(STAGES)('round-trips to %s from any starting point', target => {
    for (const start of [[], ['complete'], ['complete', 'waiting'], ['complete', 'complete', 'complete', 'in_progress'], ['complete', 'complete', 'complete', 'complete']] as PhaseStatus[][]) {
      expect(jobStage(apply(phases(start), target), 'j1').stage).toBe(target)
    }
  })
})
