# Testing report

All tests run against a production build (`next build` + `next start`) with a local PostgreSQL 16 database. Nothing was tested on a physical phone or tablet; every "device" result below is **browser emulation in Chromium** (Playwright device profiles for iPhone 14 and iPad). Safari/WebKit was not available in the build environment.

## How to run
```
npm run test        # 28 unit tests (capacity, scheduler, estimate recommendation, email matching)
npm run test:e2e    # 14 end-to-end runs: 12 desktop + core workflow on iPhone and iPad profiles
```
The end-to-end suite wipes the connected database first, so point `DATABASE_URL` at a test database.

## Required scenarios

| # | Scenario | Result | How |
|---|---|---|---|
| 1 | Create client, project, estimate, tasks, time entries | ✅ pass | Browser test on desktop, iPhone, iPad: `tests/e2e/core.ui.spec.ts` |
| 2 | Erika prepares an estimate; only Brian can approve | ✅ pass | API test: staff approve → 403; owner approve → approved, project hours/fee updated, audit entry recorded |
| 3 | Working hours + Google Calendar appointments determine capacity | ✅ pass (engine) / ✅* (live) | Unit tests for windows, breaks, buffer, overlap merging, free/cancelled events, all-day busy, DST; API test with stored calendar events (two overlapping events count once; free and app-published events ignored). Live Google sync not run (no credentials). |
| 4 | Recommendation does not change approved schedule until Brian accepts | ✅ pass | API test: schedule identical after proposal; staff accept → 403; owner accept applies |
| 5 | Locked work survives subsequent recommendations | ✅ pass | Unit test + API test: locked block kept at same date/hours/id |
| 6 | Manual scheduling possible with clear conflict warnings | ✅ pass | Browser test (overbook dialog on all three profiles) + API test (409 with details, day-off warning, nothing moved) |
| 7 | What-if changes do not affect live schedule | ✅ pass | API test: block set byte-identical before/after running a scenario |
| 8 | Changes appear across devices and both accounts | ✅ pass | API test across two sessions + second browser context sees the change |
| 9 | Concurrent edits do not silently lose data | ✅ pass | Stale version → 409 with current copy; fresh version succeeds |
| 10 | Timers accurate across devices and browser restarts | ✅ pass | Start in one browser context, close it, read from API and a new context; switching stops the previous timer; database rejects a second running timer |
| 11 | Estimate recommendations handle missing/limited history honestly | ✅ pass | Unit tests + API test: "none" → "template" → "weak evidence (1 comparable)" |
| 12 | Calendar updates do not create duplicate events or scheduling loops | ✅ pass (storage rules) / ✅* (live) | Unique (calendar, event id) upsert; cancelled events ignored; app-published events excluded from capacity; write-back is an explicit button, never automatic, so no loop is possible |
| 13 | Core workflows at desktop, iPhone and iPad sizes | ✅ pass (emulated) | Same workflow run on three Playwright profiles, plus a horizontal-overflow check |

## Also verified
- Owner-only routes reject staff (project types, rates, users, publish); anonymous API calls get 401.
- CSV and JSON exports.
- Undo of an accepted proposal restores the previous blocks with their original ids.
- Drag-and-drop reorder/move was exercised by hand in desktop emulation during development, not in the automated suite (touch devices use the Edit dialog, which is tested).

## Not tested / known gaps
- **Live Google OAuth, Calendar sync, write-back and Gmail scanning** against real Google accounts: the code paths are complete but could not be exercised without your Google Cloud credentials. Expect to find rough edges on first connection; errors are surfaced on Settings → Google.
- **Physical devices and Safari**: installing to the iPhone/iPad home screen, the service worker on iOS Safari, and printing from Safari.
- **Long-running timers across a DST change**: durations are computed from UTC timestamps so this should be correct, but it was not observed over a real DST boundary.
- **Email matching quality** on real mail: the heuristics are unit-tested on synthetic messages only.
