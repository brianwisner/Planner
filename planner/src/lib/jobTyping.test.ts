import { describe, expect, it } from 'vitest'
import { guessType, words } from './jobTyping'
import type { Job, JobType, PastJob } from './types'

const type = (id: string, name: string, keywords: string): JobType => ({
  id, name, keywords, design_hours: 0, plan_check_hours: 0, construction_hours: 0, site_visits: 0, size_unit: '', notes: '', created_at: '',
})
const types = [
  type('deck', 'Deck / stair', 'deck, porch, stair, balcony'),
  type('beam', 'Beam or header', 'beam, header, bearing wall, girder'),
  type('add', 'Addition', 'addition, bump out, second story'),
]
const job = (id: string, name: string, description = '', job_type_id: string | null = null) => ({ id, name, description, job_type_id }) as Job
const past = (name: string, scope: string, job_type_id: string) => ({ name, scope, job_type_id }) as PastJob

describe('automatic job typing', () => {
  it('normalizes plurals and skips filler words', () => {
    expect(words('New Decks for the Smith Residence')).toEqual(['deck', 'smith'])
  })

  it('matches key words, including phrases', () => {
    const s = { jobTypes: types, jobs: [], pastJobs: [] }
    expect(guessType(s, 'New Deck')?.type.id).toBe('deck')
    expect(guessType(s, 'Remove bearing wall in kitchen')?.type.id).toBe('beam')
    expect(guessType(s, 'Kristen Wilken — Reinforce floor beam over garage')?.type.id).toBe('beam')
    expect(guessType(s, 'Hunter Residence')).toBeNull()
  })

  it('gives ties to the type mentioned first, and ignores words in type names', () => {
    const s = { jobTypes: [...types, type('rem', 'Remodel', 'remodel, renovation'), type('lat', 'Lateral / shear wall', 'shear wall, lateral')], jobs: [], pastJobs: [] }
    expect(guessType(s, 'Deck remodel')?.type.id).toBe('deck')
    expect(guessType(s, 'Remodel with new deck')?.type.id).toBe('rem')
    expect(guessType(s, 'Garden wall')).toBeNull()
  })

  it('learns words from jobs and past records already of a type', () => {
    const s = {
      jobTypes: types, pastJobs: [past('Lee', 'Sunroom bump out', 'add'), past('Diaz', 'sunroom on slab', 'add')],
      jobs: [job('a', 'Ng', 'Sunroom', 'add')],
    }
    const g = guessType(s, 'Sunroom for the Parks')
    expect(g?.type.id).toBe('add')
    expect(guessType({ ...s, pastJobs: [] , jobs: [] }, 'Sunroom for the Parks')).toBeNull()
  })
})
