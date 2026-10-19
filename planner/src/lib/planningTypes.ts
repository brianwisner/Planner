import type { Session } from '@supabase/supabase-js'

export interface PlanningRecord {
  id: string
  revision: number
  created_at: string
  updated_at: string
}
export interface ReviewPriority {
  id: string
  title: string
  job_id: string | null
  done: boolean
  source_id?: string
}
export interface DailyReview extends PlanningRecord {
  review_date: string
  checkpoint_at: string
  completed_at: string | null
  notes: string
  priorities: ReviewPriority[]
}
export interface ContactLogEntry {
  id: string
  date: string
  note: string
  promised_date?: string | null
}
export interface FollowUp extends PlanningRecord {
  job_id: string | null
  invoice_id: string | null
  title: string
  waiting_on: string
  reason: string
  status: 'open' | 'done'
  next_follow_up_date: string | null
  promised_date: string | null
  invoice_due_date: string | null
  contact_log: ContactLogEntry[]
  notes: string
}
export interface DailyAvailability extends PlanningRecord {
  date: string
  base_hours: number
  note: string
}
export type AvailabilityBlockKind = 'appointment' | 'travel' | 'admin' | 'time_off' | 'buffer' | 'other'
export interface AvailabilityBlock extends PlanningRecord {
  date: string
  title: string
  kind: AvailabilityBlockKind
  hours: number
  note: string
}
export interface JobPlanning extends PlanningRecord {
  job_id: string
  status_update: string
  next_deliverable: string
  remaining_hours: number | null
  internal_target_date: string | null
  client_commitment_date: string | null
}
export type DecisionKind = 'decision' | 'scope_change'
export type BillingTreatment = 'undecided' | 'billable' | 'included' | 'nonbillable'
export type DecisionApproval = 'not_needed' | 'needed' | 'approved' | 'declined'
export interface JobDecision extends PlanningRecord {
  job_id: string | null
  kind: DecisionKind
  title: string
  notes: string
  estimated_hours: number | null
  billing_treatment: BillingTreatment
  approval: DecisionApproval
  recorded_date: string
}
export interface PlanningEvent {
  id: string
  occurred_at: string
  actor_id: string | null
  entity_type: string
  entity_id: string
  job_id: string | null
  action: 'insert' | 'update' | 'delete'
  summary: string
  changed_fields: string[]
}
export interface PlanningTables {
  daily_reviews: DailyReview
  follow_ups: FollowUp
  daily_availability: DailyAvailability
  availability_blocks: AvailabilityBlock
  job_planning: JobPlanning
  job_decisions: JobDecision
}
export type PlanningTableName = keyof PlanningTables
export interface PlanningScheduleMove {
  id: string
  expected_job_id: string
  expected_phase_id: string | null
  expected_date: string
  expected_hours: number
  date: string
  hours: number
}
export interface PlanningStore {
  reviews: DailyReview[]
  followUps: FollowUp[]
  availability: DailyAvailability[]
  blocks: AvailabilityBlock[]
  jobPlanning: JobPlanning[]
  decisions: JobDecision[]
  events: PlanningEvent[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  save: <K extends PlanningTableName>(table: K, row: Partial<PlanningTables[K]> & { id: string }, expectedRevision?: number) => Promise<PlanningTables[K] | null>
  remove: (table: PlanningTableName, id: string, revision: number) => Promise<boolean>
  applyMoves: (moves: PlanningScheduleMove[]) => Promise<boolean>
}
export interface PlanningProviderProps { session: Session | null; children: import('react').ReactNode }
