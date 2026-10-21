// Automatic job typing: guess a job's type from its name and scope, using each
// type's key words plus the words on jobs (and past jobs) already of that type.
import type { Store } from './store'
import type { Job, JobType } from './types'

// Words that say nothing about the kind of structure.
const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'new', 'old', 'existing', 'job', 'project', 'residence', 'home', 'house', 'property',
  'owner', 'client', 'construction', 'builders', 'builder', 'homes', 'llc', 'inc', 'company', 'street', 'avenue', 'ave', 'road',
  'drive', 'lane', 'way', 'loop', 'court', 'oregon', 'washington', 'county', 'city', 'phase', 'notes', 'delivered', 'plans',
  'structural', 'engineering', 'design', 'calcs', 'calculations', 'review', 'per', 'over', 'into', 'this', 'that', 'need', 'needs',
])

// Common spelling variants that mean the same thing.
const SAME: Record<string, string> = { decks: 'deck', decking: 'deck', beams: 'beam', headers: 'header', additions: 'addition', adus: 'adu', garages: 'garage', walls: 'wall', retaining: 'retain', foundations: 'foundation', footings: 'footing', stairs: 'stair', porches: 'porch', remodeling: 'remodel', remodels: 'remodel', bathrooms: 'bathroom', bath: 'bathroom', barns: 'barn', shops: 'shop', sheds: 'shed' }

export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]+/g) ?? [])
    .map(w => SAME[w] ?? (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .filter(w => (w.length >= 3 || w === 'ti') && !STOP.has(w))
}

export const keywordList = (t: Pick<JobType, 'keywords'>) => t.keywords.split(/[,;\n]/).map(k => k.trim().toLowerCase()).filter(Boolean)


const jobText = (j: Pick<Job, 'name' | 'description'>) => `${j.name} ${j.description ?? ''}`

export interface TypeGuess { type: JobType; score: number; matched: string[] }

type TypingStore = Pick<Store, 'jobTypes' | 'jobs' | 'pastJobs'>

/**
 * Best-matching job type for some text, or null when nothing fits well enough.
 * Key words (and phrases like "bearing wall") count most, then words in the
 * type's name, then words that keep showing up on jobs already of that type.
 */
export function guessType(store: TypingStore, text: string, exceptJobId?: string): TypeGuess | null {
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  const mine = new Set(words(text))
  if (!mine.size) return null
  // How many types use each learned word: common words count less.
  const learned = new Map<string, Map<string, number>>()
  for (const t of store.jobTypes) learned.set(t.id, new Map())
  const learn = (typeId: string | null, text: string) => {
    const m = typeId ? learned.get(typeId) : undefined
    if (m) for (const w of new Set(words(text))) m.set(w, (m.get(w) ?? 0) + 1)
  }
  for (const j of store.jobs) if (j.id !== exceptJobId) learn(j.job_type_id, jobText(j))
  for (const p of store.pastJobs) learn(p.job_type_id, `${p.name} ${p.scope}`)
  const spread = new Map<string, number>()
  for (const m of learned.values()) for (const w of m.keys()) spread.set(w, (spread.get(w) ?? 0) + 1)

  let best: (TypeGuess & { at: number }) | null = null
  for (const t of store.jobTypes) {
    let score = 0, at = Infinity
    const matched: string[] = []
    const keys = keywordList(t)
    for (const k of keys) {
      const phrase = ` ${k.replace(/[^a-z0-9]+/g, ' ').trim()} `
      const multi = phrase.trim().includes(' ')
      const pos = multi ? lower.indexOf(phrase) : Math.min(...words(k).map(w => mine.has(w) ? firstAt(lower, w) : Infinity))
      if (pos >= 0 && pos < Infinity) { score += multi ? 4 : 3; matched.push(k); at = Math.min(at, pos) }
    }
    // The type's own name only helps when it has no key words.
    if (!keys.length) for (const w of new Set(words(t.name))) if (mine.has(w)) { score += 2; matched.push(w); at = Math.min(at, firstAt(lower, w)) }
    for (const [w, n] of learned.get(t.id) ?? []) {
      if (!mine.has(w) || matched.some(m => m.includes(w))) continue
      // A word seen on 3+ jobs of only this type is enough on its own.
      score += Math.min(2, (2 * n) / 3) / (spread.get(w) ?? 1)
    }
    // Ties go to the type mentioned first ("Deck remodel" is a deck).
    if (score > (best?.score ?? 0) || (best && score === best.score && at < best.at)) best = { type: t, score, matched, at }
  }
  return best && best.score >= 2 ? { type: best.type, score: best.score, matched: best.matched } : null
}

/** Where a word (or its plural) first appears in the text, for breaking ties. */
function firstAt(lower: string, w: string): number {
  const m = new RegExp(`\\b${w}`).exec(lower)
  return m ? m.index : Infinity
}

export const guessJobType = (store: TypingStore, job: Pick<Job, 'id' | 'name' | 'description'>) => guessType(store, jobText(job), job.id)
