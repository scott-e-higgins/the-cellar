# The Cellar

The Cellar is a private, cloud-first progressive web app for a household wine collection. It keeps a durable ledger of purchases, bottle locations, movements, openings, tasting notes, winery visits, photos, receipts, and optional references to Travel Journal trips.

Version 1.0.0 completes the initial cloud-first application scope in the Cellar Master Build Brief.

This repository is independent from the Travel Journal. No Travel Journal code or data is modified by this project.

The source repository is intentionally public, consistent with the existing Travel Journal. It contains application code, migrations, placeholders, and documentation only—never passwords, secret/service-role keys, private wine records, receipts, photos, or production exports.

## Status

The initial v1 application is complete: authentication, Home, inventory search and filters, wine and winery detail/editing, purchase and movement history, configurable storage, atomic bottle opening with personal reviews, visits, private photos, private receipts/documents, favorites, statistics, PWA behavior, and future Travel Journal reference architecture.

The approved historical spreadsheet import has been completed in production. Private inventory records and import payloads are not stored in this repository. Demo records are never compiled into the default build.

## Stack

- React + TypeScript + Vite
- Supabase Auth, Postgres, Row Level Security, and private Storage
- Installable PWA with prompt-based updates
- GitHub Actions and GitHub Pages

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Add the URL and publishable/anonymous key for The Cellar's own Supabase project.
3. Run `npm install`.
4. Run `npm run dev`.

The app shows a setup screen when the two Supabase values are absent. The publishable key is designed for browser use and cannot bypass RLS. Never commit a secret/service-role key; it does not belong in the browser, repository, or GitHub Pages configuration.

## Supabase setup

The independent project has been provisioned and all files in `supabase/migrations/` have been applied in order. For a fresh environment:

1. Create a new Supabase project specifically for The Cellar.
2. Apply every SQL file in `supabase/migrations/` in filename order.
3. Create the household members' Auth users in the dashboard.
4. Copy `supabase/seed.example.sql`, replace all placeholder UUIDs, and run the edited statements once.
5. Confirm each account can see the household and that no unauthenticated request can read its rows or private files.

The example seed adds generic configurable top-level storage locations. They are data, not hard-coded UI rules.

## GitHub Pages setup

Create these repository secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

In repository settings, choose **GitHub Actions** as the Pages source. A push to `main` then tests, builds, and deploys the PWA.

The production custom domain is `https://cellar.higgshome.com`. In the GitHub Pages settings, set `cellar.higgshome.com` as the custom domain. At the DNS provider, create a `CNAME` record for `cellar` pointing directly to `scott-e-higgins.github.io` and enable HTTPS after GitHub provisions the certificate.

The deployed application shell is publicly reachable, but application records require a valid Supabase session and matching household membership. The repository and static bundle must always be treated as public.

## Commands

```sh
npm run dev
npm test
npm run build
npm run preview
npm run import:preview -- path/to/original.xlsx --output import-preview.json
```

## Design and data rules

- A wine is the reusable identity; repeat acquisitions become new purchase items, never duplicate wines.
- Inventory is derived from immutable receive/move/open/adjust movements.
- Purchases, openings, and tasting history are retained. Referenced history is protected by restrictive foreign keys.
- Storage locations are configurable records.
- Travel Journal references are optional external identifiers and deep-link paths. They do not couple databases.
- Photos and documents live in private buckets under paths beginning with the household UUID.

See [Architecture](docs/architecture.md), [Data integrity](docs/data-integrity.md), [Import mapping checkpoint](docs/import-mapping.md), and the separately controlled [Travel Journal integration plan](docs/travel-journal-integration-plan.md).
