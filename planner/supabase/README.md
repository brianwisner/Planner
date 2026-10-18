# Planner database changes

`setup.sql` creates a new Supabase project. The following migration was applied
to the live project on 2026-10-18. Other existing projects must apply it once
before deploying the matching app:

`migrations/20261018201758_preserve_deposit_credits_and_recurring_task_parent.sql`

The migration runs in one transaction. It adds nullable columns, constraints,
a trigger, and an invoice function; it does not update existing financial records, invoice amounts,
ownership, billing rates, or access policies.

- `time_entries.deposit_applied` and `job_items.deposit_applied` save the amount
  of deposit credit used when the rest of a work row is invoiced. A recorded zero
  means no credit was used. Existing rows keep `NULL`: the old schema did not
  save enough information to reconstruct historical credits reliably.
- The trigger clears a snapshot when a work row becomes unbilled or its invoice
  link is removed, including when an invoice deletion clears that link through
  its foreign key. Removing an existing link also unbills the row. Legacy
  `billed` flags whose invoice link was already missing are left intact. While a
  credit is saved, moving the work to another job or reducing its value below
  that credit requires unbilling it first.
- `record_invoice(p_job_id, p_number, p_amount, p_issued_date, p_paid_date,
  p_notes, p_links)` creates an invoice and links all selected work in one
  transaction. Each JSON link contains `table` (`time_entries` or `job_items`),
  `id`, `amount` (gross work value), and `depositApplied`. The function locks the
  job and allocation inputs, recomputes oldest-first deposit coverage, and
  rejects stale work, mismatched amounts/credits, duplicate IDs, and work from
  another job before saving. Any write failure rolls back the entire request.
  An empty link list supports a standalone invoice. The function returns one
  invoice row and uses the caller's RLS; only authenticated users receive
  permission to execute it. Invoice amount remains editable independently of
  linked gross work, matching the existing record-invoice workflow.
- `tasks.recurrence_parent_id` links the next occurrence to the task completed
  before it. A unique constraint allows at most one next occurrence, while
  ordinary tasks can all have `NULL`. Deleting a parent keeps the next task and
  clears the link. A task cannot be its own parent.

GitHub Pages deployment builds the frontend; it does not apply SQL migrations.
Apply this migration once through the Supabase SQL Editor or the project's
normal migration process. Do not rerun the complete `setup.sql` on an existing
project in place of this migration.

Schema regression checks in `tests/recurrence_and_deposit.sql` and
`tests/record_invoice.sql` use synthetic
records and roll back their writes. Run them only against a disposable local
database after applying either the fresh setup or the migration. They verify
constraints, invoice-link cleanup, guarded work edits, atomic invoice rollback,
allocation validation, and function access; they are not a production migration
step. Historical billing fields and invoice amounts are preserved by the
migration, with no guessed deposit-credit backfill.
