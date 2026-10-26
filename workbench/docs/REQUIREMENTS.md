# Requirements checklist

Status key: ✅ built and tested · ✅* built, tested only in emulation or without live Google credentials · ⚠️ partial / needs your setup · ❌ not built

## 1. Research
| Requirement | Status | Where |
|---|---|---|
| Research leading tools with cited sources, verified vs assumed | ✅ (page fetches were blocked; claims rest on cited search excerpts) | `docs/RESEARCH.md`, `docs/RESEARCH-NOTES.md` |
| Comparison of what to adopt / leave out and why | ✅ | `docs/RESEARCH.md` |

## 2. Business scope
| Requirement | Status | Where |
|---|---|---|
| Project planning, scheduling & capacity, estimates, time tracking, client records, reports | ✅ | whole app |
| Fresh empty production database; nothing imported | ✅ | migrations create empty tables; sample data only when `APP_ENV=demo` |
| No invoicing / accounting / payroll / client portal; structure extensible | ✅ | billing rates and billable flags exist for later; export covers all records |
| Minimal data entry, clear daily decisions | ✅ | templates, Today view, one-tap timer |

## 3. Users and permissions
| Requirement | Status | Where |
|---|---|---|
| Two users, Brian = owner, Erika = staff | ✅ | Setup page creates owner; Settings → Users adds staff |
| Only owner approves estimates and accepts schedule changes, enforced server-side | ✅ tested | `requireOwner()` in approve/reject, accept/undo, blocks, project types, rates, users |
| Staff manages clients/projects, enters time, prepares estimates & proposals | ✅ tested | all other routes `requireUser()` |
| Activity history of who changed what, when | ✅ | `audit_log`, shown on records and Settings → History |

## 4. Project and client records
| Requirement | Status | Where |
|---|---|---|
| Multiple projects per client | ✅ | |
| Client: contacts, linked projects, notes, correspondence, history | ✅ | Client page |
| Project: client, name, address, type, scope, status, priority, dependencies | ✅ | Project page |
| Inquiry & acceptance dates distinct from actual start; planned start, target, client due date, actual completion | ✅ | status changes fill dates automatically without overwriting |
| Estimated hours, actual hours, remaining effort (separately maintained) | ✅ | "Update remaining" |
| Estimate & fee information | ✅ | synced from approved estimates |
| Tasks, milestones, notes, links | ✅ | |
| Waiting items, blockers, scope changes | ✅ | blockers hold scheduling; scope changes carry added hours/fee |
| Configurable structural project types with templates | ✅ | 12 defaults; Settings → Project types |
| Unaccepted opportunities visible but out of committed workload unless reserved | ✅ tested | `tentativeReserve` flag; "include tentative" on recommendation |

## 5. Scheduling
| Requirement | Status | Where |
|---|---|---|
| Working hours per weekday, recurring + date exceptions | ✅ tested | Settings → Working hours |
| Google Calendar appointments reduce availability; overlaps not double-counted; breaks, time off, buffer | ✅ tested (engine + stored events) ✅* (live Google sync needs credentials) | `engine/capacity.ts`, calendar sync |
| America/Los_Angeles default, DST-correct | ✅ tested | Luxon wall-clock windows; DST test |
| Recommendations from remaining effort, hours, priorities, deadlines, dependencies, blockers, commitments, WIP limit | ✅ tested | `engine/scheduler.ts` |
| Proposals until accepted; shows what moves, why, forecast impact | ✅ tested | Proposal page |
| Accept / reject / adjust / manual scheduling / drag reorder & move / lock / fixed commitments / undo / what-if | ✅ tested (drag tested manually in desktop emulation only) | Schedule board, proposals, what-if |
| Manual decisions & locks preserved in later recommendations | ✅ tested | |
| Overbooking explained, owner decides, nothing silently moved | ✅ tested | 409 conflict + confirm |
| Conflicts flagged when calendar/project conditions change; no silent change to approved schedule | ✅ | overbooked days flagged on Today/Schedule; blocked projects listed; new recommendations are proposals |
| Forecast completion distinct from client commitment | ✅ | separate fields and labels everywhere |

## 6. Estimates
| Requirement | Status | Where |
|---|---|---|
| Manual estimates + reusable templates | ✅ tested | Estimate editor, "Import project tasks" |
| No invented history; honest when data is thin | ✅ tested | "template default" / "no basis" states |
| Suggestions from comparable completed projects: which projects, how many, differences/assumptions, range, evidence strength, est vs actual | ✅ tested | `engine/estimates.ts` |
| Adjust every recommendation before approving | ✅ | |
| Hourly and fixed fee, configurable rates, phase breakdown, revisions kept | ✅ | |
| Original vs added scope separated | ✅ | `scopeKind` on estimates, scope-change items |
| Clean printable summary | ✅ | Print / PDF button, print stylesheet |

## 7. Time tracking
| Requirement | Status | Where |
|---|---|---|
| Start/stop timer and manual entry; project + optional task; date, duration, notes, billable | ✅ tested | |
| Start from daily view, switch projects | ✅ tested | Today "Start" per block |
| Timer accurate across tab close, device change, connectivity loss; no duplicate active timers | ✅ tested (server timestamps + DB unique index) | |
| Correct entries; daily and weekly totals | ✅ | Time page |
| Actual vs estimated; remaining tracked separately and editable | ✅ | Project page, Reports |

## 8. Gmail and Google Calendar
| Requirement | Status | Where |
|---|---|---|
| Real OAuth integration, minimal scopes, encrypted tokens | ✅* code complete; needs your Google Cloud client | `lib/google/*`, `docs/DEPLOYMENT.md` |
| Gmail: identify client/project mail, suggest links, create draft client/project/task with review, keep link to original, never send/delete/archive/relabel | ✅* read-only scope only; matching engine unit-tested | Inbox page |
| Email treated as untrusted data | ✅ | text only, never interpreted |
| Calendar: choose calendars, recurring/cancelled/all-day/free-busy handled, no duplicates, no double-count of app blocks, optional write-back with defined sync rules | ✅* storage rules tested; live sync untested here | Settings → Google |
| Connection, sync status and failures shown | ✅ | Settings → Google |

## 9. Devices
| Requirement | Status | Where |
|---|---|---|
| Responsive, touch-friendly; no hover/right-click/drag-only actions | ✅ tested at 1440px, iPhone 14, iPad | bottom tabs on phones; Edit dialog for moves |
| Shared cloud database, authenticated accounts | ✅ | Postgres + sessions |
| Concurrent edits don't silently overwrite; saved/saving/offline/error states | ✅ tested | version checks → 409; SaveIndicator; offline banner |
| Offline strategy documented, no false "saved" | ✅ | read-only cached pages; writes fail visibly (`docs/USER_GUIDE.md`) |
| Installable PWA; Safari on iPhone/iPad | ✅* manifest + service worker; **not tested on physical Safari** | |

## 10. Design
| Requirement | Status |
|---|---|
| Calm, readable interface; charts where meaningful | ✅ (see `docs/screenshots/`) |
| Daily view: what to work on, hours & scheduled work, appointments, deadlines/at-risk, blockers/approvals, quick timer | ✅ |
| Project, client, schedule, estimate, report views without duplicates | ✅ |
| Reports: workload vs capacity, est vs actual, remaining, deadlines, accuracy by type | ✅ |
| Empty states explain next step; sample data only in labeled demo | ✅ |

## 11. Engineering
| Requirement | Status | Where |
|---|---|---|
| Maintainable stack, deployment path, operating cost explained | ✅ | `docs/RESEARCH.md`, `docs/DEPLOYMENT.md` |
| Secure auth, server-side authorization, safe credential handling, no secrets in code | ✅ | bcrypt, httpOnly cookies, AES-GCM token encryption, env vars |
| Migrations | ✅ | `drizzle/`, `npm run migrate` |
| Backups & recovery instructions | ✅ | `docs/DEPLOYMENT.md` |
| Export of core records | ✅ | CSV/JSON |
| Audit history | ✅ | |
| Loading, empty, failure, disconnected states | ✅ | |

## 12. Tests
See `docs/TESTING.md` for the scenario-by-scenario record (13/13 covered; 3 only in emulation or without live Google).
