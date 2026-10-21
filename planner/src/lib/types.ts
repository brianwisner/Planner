// Shapes of the rows in each database table. Keep in sync with supabase/setup.sql.

export type JobStatus = 'active' | 'on_hold' | 'complete' | 'cancelled' | 'archived'
export type PhaseKind = 'bidding' | 'queued' | 'design' | 'plan_check' | 'construction' | 'client_changes'
export type PhaseStatus = 'not_started' | 'in_progress' | 'waiting' | 'complete'
export type TaskStatus = 'todo' | 'doing' | 'waiting' | 'done'
export type Recurrence = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly'

export interface Settings {
  id: number
  company_name: string
  business_email: string
  default_rate: number
  weekly_capacity: number
  minimum_fee: number           // the fee estimator never suggests less
  site_visit_hours: number      // hours per site visit, including travel and follow-up
  retainer_percent: number      // retainer shown on proposals; 0 leaves it out
  proposal_template: string     // blank uses DEFAULT_PROPOSAL_TEMPLATE in lib/estimate.ts
}

export interface Profile {
  id: string
  email: string | null
  full_name: string
  color: string
  hourly_rate: number | null
  weekly_hours: number
  ics_token: string
  created_at: string
}

export interface Client {
  id: string
  name: string
  contact_name: string
  email: string
  phone: string
  address: string
  notes: string
  is_sample: boolean
  created_at: string
}

/** A kind of job with the owner's usual hours per phase, used by the fee estimator. */
export interface JobType {
  id: string
  name: string
  design_hours: number
  plan_check_hours: number
  construction_hours: number
  site_visits: number           // usual number of site visits during construction
  size_unit: string             // e.g. "sq ft" or "ft of wall"; blank = size not tracked
  keywords: string              // comma-separated words that identify this type (automatic typing)
  notes: string
  created_at: string
}

export interface Job {
  id: string
  client_id: string
  job_number: string
  name: string
  description: string
  address: string
  status: JobStatus
  priority: number
  fee: number | null
  job_type_id: string | null      // links finished jobs to the fee estimator
  size: number | null             // in the job type's size unit
  use_in_estimates: boolean       // false leaves a finished job out of the fee estimator
  estimate_note: string           // why it was left out
  closeout_reason: string         // what made the hours differ from the quote (CLOSEOUT_REASONS)
  queued_date: string | null      // legacy storage; no longer an active workflow control
  start_date: string | null
  due_date: string | null
  created_at: string
}

/** A job from before the planner (found in email, invoices or files): fee evidence and typing examples. */
export interface PastJob {
  id: string
  name: string
  client: string
  address: string
  job_type_id: string | null
  date: string | null
  fee: number | null            // what was charged
  hours: number | null          // only when actually known
  size: number | null
  scope: string
  source: string
  use_in_estimates: boolean
  created_at: string
}

/** A fee saved from the estimator. Never edited, so the original quote survives later changes. */
export interface Quote {
  id: string
  job_id: string
  job_type_id: string | null
  rate: number
  design_hours: number          // final hours per phase, including visits and allowance
  plan_check_hours: number
  construction_hours: number
  site_visits: number
  visit_hours: number
  allowance_hours: number
  rush_percent: number
  size: number | null
  suggested_fee: number
  fee: number
  fee_note: string              // why the fee differs from the suggestion
  created_at: string
}

export const CLOSEOUT_REASONS = ['Went as planned', 'Scope was bigger than quoted', 'Existing conditions', 'Plan-check comments', 'Coordination with others', 'Rework / my changes', 'Time records incomplete'] as const

export interface Phase {
  id: string
  job_id: string
  kind: PhaseKind
  name: string
  sort_order: number
  status: PhaseStatus
  estimate_hours: number
  start_date: string | null
  due_date: string | null
  assignee_id: string | null
  notes: string
}

export interface Task {
  id: string
  job_id: string
  phase_id: string | null
  title: string
  description: string
  status: TaskStatus
  assignee_id: string | null
  due_date: string | null
  scheduled_at: string | null
  is_site_visit: boolean
  estimate_hours: number | null
  recurrence: Recurrence
  recurrence_parent_id: string | null // the completed occurrence that created this task
  sort_order: number
  completed_at: string | null
  created_by: string | null
  created_at: string
}

export interface Invoice {
  id: string
  job_id: string
  number: string
  amount: number
  issued_date: string
  paid_date: string | null
  notes: string
  created_at: string
}

export interface TimeEntry {
  id: string
  job_id: string
  phase_id: string | null
  task_id: string | null
  user_id: string
  date: string
  hours: number | null
  started_at: string | null
  rate: number | null           // $/hour saved when the entry was created
  notes: string
  billable: boolean           // false records internal/rework hours without charging the client
  billed: boolean
  invoice_id: string | null
  deposit_applied: number | null // deposit credit preserved when the remainder is invoiced
  created_at: string
}

export interface Deposit {
  id: string
  job_id: string
  amount: number
  received_date: string
  method: string
  notes: string
  created_at: string
}

/** Planned (not yet worked) hours for a person on a day, set from the Gantt chart. */
export interface ScheduleEntry {
  id: string
  job_id: string
  phase_id: string | null
  user_id: string
  date: string
  hours: number
  note: string
  created_at: string
}

/** A billable charge on a job other than hours (expense, mileage, fee...). */
export interface JobItem {
  id: string
  job_id: string
  date: string
  category: string
  description: string
  quantity: number
  unit_price: number
  billed: boolean
  invoice_id: string | null
  deposit_applied: number | null // null for unbilled work and legacy invoice links
  created_by: string | null
  created_at: string
}

export const ITEM_CATEGORIES = ['Expense', 'Mileage', 'Printing / plotting', 'Permit / filing fee', 'Site visit', 'Fixed fee', 'Other'] as const

export interface Comment {
  id: string
  job_id: string
  user_id: string | null
  body: string
  created_at: string
}

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  active: 'Active',
  on_hold: 'On hold',
  complete: 'Complete',
  cancelled: 'Cancelled',
  archived: 'Archived',
}

export const PHASE_STATUS_LABEL: Record<PhaseStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  waiting: 'Waiting',
  complete: 'Complete',
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To do',
  doing: 'In progress',
  waiting: 'Waiting',
  done: 'Done',
}

export const PHASE_KIND_LABEL: Record<PhaseKind, string> = {
  bidding: 'Bidding',
  queued: 'Planning history',
  design: 'Original design',
  plan_check: 'County / plan-check comments',
  construction: 'Construction changes',
  client_changes: 'Client-requested changes',
}

export const PHASE_KIND_SHORT: Record<PhaseKind, string> = {
  bidding: 'Bidding',
  queued: 'Planning history',
  design: 'Design',
  plan_check: 'Plan check',
  construction: 'Construction',
  client_changes: 'Client changes',
}

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  none: 'Does not repeat',
  daily: 'Every day',
  weekly: 'Every week',
  biweekly: 'Every 2 weeks',
  monthly: 'Every month',
}
