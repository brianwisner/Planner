import type { Phase } from './types'

/** Legacy Queued rows are stored history, never an active workflow stage. */
export function isWorkflowPhase(phase: Pick<Phase, 'kind'>): boolean {
  return phase.kind !== 'queued'
}

/** A saved custom label must not reintroduce the retired stage in the UI. */
export function phaseLabel(phase: Pick<Phase, 'kind' | 'name'>): string {
  return isWorkflowPhase(phase) ? phase.name : 'Planning history'
}

export function jobPhaseGroups(phases: Phase[], jobId: string) {
  const all = phases.filter(phase => phase.job_id === jobId)
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
  return { all, workflow: all.filter(isWorkflowPhase), history: all.filter(phase => !isWorkflowPhase(phase)) }
}
