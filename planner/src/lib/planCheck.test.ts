import { describe, expect, it } from 'vitest'
import { commentLabel, parseComments, planCheckStatus } from './planCheck'
import type { PlanCheckComment, PlanCheckRound } from './types'

describe('parseComments', () => {
  it('splits a numbered letter, keeps wrapped lines with their comment and skips the heading', () => {
    const letter = `SKAGIT COUNTY PLANNING & DEVELOPMENT
Structural plan review comments — BP26-0412

1. Provide anchor spacing on the wall sections, not only
   in the anchor schedule.
2) Show the diaphragm nailing for the new overlay:
   a. boundary nailing
   b. edge nailing
3: Provide calculations for the gable end walls.`
    expect(parseComments(letter)).toEqual([
      { number: '1', comment: 'Provide anchor spacing on the wall sections, not only in the anchor schedule.' },
      { number: '2', comment: 'Show the diaphragm nailing for the new overlay: a. boundary nailing b. edge nailing' },
      { number: '3', comment: 'Provide calculations for the gable end walls.' },
    ])
  })

  it('reads reviewer prefixes, "Comment" labels and numbers on their own line', () => {
    expect(parseComments('S-1 Provide the beam bearing detail.\nS-2: Show the footing size.\nComment 3 – Specify shoring.\n4.\nAdd the hold-down schedule.')).toEqual([
      { number: 'S-1', comment: 'Provide the beam bearing detail.' },
      { number: 'S-2', comment: 'Show the footing size.' },
      { number: '3', comment: 'Specify shoring.' },
      { number: '4', comment: 'Add the hold-down schedule.' },
    ])
  })

  it('does not mistake measurements or times inside a comment for new comments', () => {
    expect(parseComments('1. Footings shall be\n12 inches deep minimum.\n2. Use 2x6 studs at\n16" o.c. per detail 3/S2.\n3:00 pm meeting noted.')).toEqual([
      { number: '1', comment: 'Footings shall be 12 inches deep minimum.' },
      { number: '2', comment: 'Use 2x6 studs at 16" o.c. per detail 3/S2. 3:00 pm meeting noted.' },
    ])
  })

  it('keeps bullets inside numbered comments, but uses them when there are no numbers', () => {
    expect(parseComments('1. Revise the notes:\n- add special inspection\n2. Sign the calcs.')).toEqual([
      { number: '1', comment: 'Revise the notes: - add special inspection' },
      { number: '2', comment: 'Sign the calcs.' },
    ])
    expect(parseComments('• First thing\n• Second thing\n  continued')).toEqual([
      { number: '', comment: 'First thing' },
      { number: '', comment: 'Second thing continued' },
    ])
  })

  it('falls back to paragraphs, then lines', () => {
    expect(parseComments('Provide a detail\nat the ridge.\n\nShow the uplift path.')).toEqual([
      { number: '', comment: 'Provide a detail at the ridge.' },
      { number: '', comment: 'Show the uplift path.' },
    ])
    expect(parseComments('Provide a detail.\nShow the uplift path.\n')).toHaveLength(2)
    expect(parseComments('   \n  ')).toEqual([])
  })

  it('labels unnumbered comments by position', () => {
    expect(commentLabel({ number: '' }, 2)).toBe('3')
    expect(commentLabel({ number: 'S-4' }, 0)).toBe('S-4')
  })
})

describe('planCheckStatus', () => {
  const round = (id: string, n: number, sent: string | null = null): PlanCheckRound => ({ id, job_id: 'j', round: n, agency: '', reviewer: '', permit_number: '', received_date: null, sent_date: sent, notes: '', created_at: '' })
  const comment = (round_id: string, done: boolean): PlanCheckComment => ({ id: Math.random().toString(), round_id, number: '', comment: 'x', response: '', done, sort_order: 0, created_at: '' })

  it('reports the latest round only', () => {
    const status = planCheckStatus({ planRounds: [round('r2', 2), round('r1', 1, '2026-01-01')], planComments: [comment('r1', true), comment('r2', true), comment('r2', false)] }, 'j')
    expect(status).toMatchObject({ total: 2, open: 1, ready: false })
    expect(status?.round.id).toBe('r2')
  })

  it('is ready to send when every comment is done and nothing was sent', () => {
    expect(planCheckStatus({ planRounds: [round('r1', 1)], planComments: [comment('r1', true)] }, 'j')?.ready).toBe(true)
    expect(planCheckStatus({ planRounds: [round('r1', 1, '2026-01-02')], planComments: [comment('r1', true)] }, 'j')?.ready).toBe(false)
    expect(planCheckStatus({ planRounds: [], planComments: [] }, 'j')).toBeNull()
  })
})
