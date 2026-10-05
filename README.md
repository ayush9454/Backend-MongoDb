# Smart Parking API

This repository deploys independently to Vercel and also runs locally with Node.js 24. Shared contracts are included as the local `vendor/contracts` package; no private npm registry or sibling repository is required.

```sh
npm ci
cp .env.example .env
npm start
```

Local startup creates a private development secret and runs a persistent embedded MongoDB replica set when `MONGO_URI` is absent. First launch requires an internet connection to download the MongoDB binary. Preserve `.mongo_data/`, `.mongo_data.config.json`, and `.dev-secrets.json`.

## Existing database

Stop application writers and take a database snapshot before migration. Review with `npm run migrate -- --dry-run`, then apply with `npm run migrate`. Apply creates a private Extended JSON backup in `backups/`; unresolved integrity problems stop conversion. Users/bookings are preserved. Resolve invalid emails, orphan references, and overlapping capacity conflicts against the original data before applying. `npm run restore -- /path/to/backup.json` restores into an empty database; `--replace` is required for a populated target and creates a pre-restore backup. Backups can contain legacy payment fields and must be protected.

## Vercel settings

Keep the Vercel project root at this repository root. `vercel.json` exports the shared Express API from `server.js`. Configure Node 24, `NODE_ENV=production`, `MONGO_URI` with an explicit database name on a replica set, a private `JWT_SECRET` of at least 32 characters, a separate `MAINTENANCE_SECRET` of at least 32 characters, and comma-separated exact frontend URLs in `CORS_ORIGINS`. Migrate before directing production traffic to API v2. JWT token changes require users to sign in again.

Schedule a POST to `/api/maintenance/expire` every minute using the maintenance bearer secret. `/health/live` verifies HTTP availability; `/health/ready` verifies the database. Enforce shared rate limits at the deployment gateway for multiple instances. Payments are simulated; no real card collection or charges.

Checks: `npm run lint`, `npm test`, `npm run test:persistence`. See [API](docs/API.md) and [verification notes](docs/VALIDATION.md).

The local combined workspace retains the canonical contracts and docs. Run its `npm run sync:repos` after changing them and `npm run check:repos` before pushing either repository.
