# Implementation verification

Automated checks use isolated data. On 2026-10-05, the operator authorized deletion of the invalid-email local user. A full Extended JSON backup was taken first; the user had no linked bookings. Only that user was deleted, and the 26 remaining migration changes applied without integrity conflicts. A subsequent database startup succeeded, retained the legacy `test` database, and confirmed the user remained absent. Private backups are stored locally in `backend/backups/` and are excluded from Git. The production database has not been accessed or migrated.

The backend suite covers JWT verification, ownership, input validation, server pricing, concurrent last-spot allocation, idempotent retries, rollback, concurrent cancellation, expiry, future legacy interval conflicts, pagination, maintenance credentials, CORS, repeatable seeding, migration preservation, healthy-data detection, capacity conflicts, orphans, and email collisions.

Frontend suites cover session verification, expiration/logout, network errors, protected routes, confirmation, ticket content, uncertain-request retry keys, visible cancellation errors, and cancellation persistence after remount.

The browser check uses the production frontend and real API against a disposable replica set: register → login → book → reload → download ticket → cancel → reload → history. The persistence check starts three separate Node processes, verifying the same users/bookings/capacity after two database restarts.

## Results

- 17 backend integration tests and 11 frontend tests passed.
- Type checking, linting, formatting, and the production build passed.
- Browser E2E passed, including mobile navigation, horizontal overflow, keyboard dismissal, and expired-session clearing.
- Two separate-process database restarts preserved users, bookings, and capacity.
- The development launcher compiled the frontend on a separate configured port and stopped both services cleanly.
- An offline `npm ci --dry-run --ignore-scripts` confirmed manifest/lockfile consistency.

## Standalone GitHub repository checks

Both existing GitHub repositories include a local `vendor/contracts` package, regenerated standalone lockfiles, deployment instructions, and their own CI workflows. Clean installs outside the combined workspace passed backend integration tests and frontend linting, type checking, all frontend tests, and the production build. The standalone backend dependency audit reports zero findings; the standalone frontend audit reports 72 findings. The combined workspace audit remains at 71, reflecting its different development dependency tree. Production branches and hosted databases are unchanged until the review branches are merged and the documented migration/environment prerequisites are satisfied.

## Remaining dependency audit findings

Compatible dependency updates were applied without replacing the retained React Scripts build tool or making forced major upgrades. The current full-workspace npm audit still reports 71 findings (3 low, 6 moderate, 62 high), including transitive build/test dependencies and React Router 6. These findings are not an assertion that all dependencies are safe for production. Review runtime exposure and plan the build-tool/router upgrade before production launch. API authorization and transactional booking tests do not substitute for that review. The lockfile records the verified dependency versions.

Deployment configurations and smoke instructions are prepared; no hosted deployment or external scheduler was created.
