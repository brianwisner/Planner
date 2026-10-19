import { describe, expect, it } from 'vitest'
import { isWorkflowPhase, jobPhaseGroups, phaseLabel } from './phases'
import type { Phase } from './types'

function phase(patch: Partial<Phase> = {}): Phase {
  return { id: 'design', job_id: 'job', name: 'Design', kind: 'design', sort_order: 2, status: 'not_started', estimate_hours: 10,
    start_date: null, due_date: null, assignee_id: null, notes: '', ...patch }
}
describe('workflow and retained planning history', () => {
  it('groups ordered phases without changing saved names, references, statuses or estimates', () => {
    const historical = phase({ id: 'old', kind: 'queued', name: 'Custom queued label', sort_order: 1, status: 'waiting', estimate_hours: 80 })
    const phases = [phase({ id: 'late', sort_order: 5 }), historical, phase(), phase({ id: 'foreign', job_id: 'other' })]
    const saved = JSON.stringify(phases)
    Object.freeze(phases)
    const result = jobPhaseGroups(phases, 'job')
    expect(result.all.map(phase => phase.id)).toEqual(['old', 'design', 'late'])
    expect(result.workflow.map(phase => phase.id)).toEqual(['design', 'late'])
    expect(result.history).toEqual([historical])
    expect(JSON.stringify(phases)).toBe(saved)
  })
  it('always labels the retired kind Planning history while preserving custom workflow names', () => {
    expect(phaseLabel(phase({ kind: 'queued', name: 'Queued custom stage' }))).toBe('Planning history')
    expect(phaseLabel(phase({ name: 'Permit response' }))).toBe('Permit response')
    expect(isWorkflowPhase(phase({ kind: 'queued' }))).toBe(false)
    expect(isWorkflowPhase(phase())).toBe(true)
  })
})
