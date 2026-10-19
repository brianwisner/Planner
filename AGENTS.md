# Working on the Wisner Engineering Planner

Read `CLAUDE.md` for the architecture, database, billing rules, and deployment details.

The owner's current direction is a **solo business**. Keep the interface focused on
one person: no staff management, assignment pickers, person filters, or team reports.
New tasks, time entries, and schedules use the signed-in owner's account. Keep
existing records, ownership, saved rates, and billing history intact. Unassigned or
previously assigned work must remain visible in the business views and workload.

The app lives in `planner/` (version 2, rebuilt in October 2026) and is published at
`https://brianwisner.github.io/Who-knows/`. `classic/` is the previous design, frozen,
published at `/Who-knows/classic/` on the same database — don't develop it. The root
HTML/JS is a separate shear-wall tool published under `/Who-knows/shear-wall/`.

Explain changes in plain English and make routine design decisions. Favor clear
labels, reachable navigation on phones, keyboard access, and simple workflows. The
owner values usability, looks and functionality most, and learns visually: show
screenshots of changes.

Run `npm test`, `npm run build` and `npm run lint` from `planner/` after code changes.
Check responsive or form changes with `npm run demo` (made-up data in memory, no
login); never use live customer records for test writes.
