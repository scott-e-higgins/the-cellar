# Security policy

The Cellar's source code is public. Its household data is not.

## Repository rules

- Commit only source code, migrations, documentation, placeholder configuration, and intentionally public visual assets.
- Never commit populated `.env` files, secret/service-role keys, passwords, session tokens, production database exports, original import spreadsheets, receipts, private photographs, or personal contact details.
- Use only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the static browser build. A publishable key identifies the Supabase project; it does not authorize access to household rows.
- Store deployment values in GitHub Actions secrets even when they are browser-safe, keeping project-specific configuration out of source history.
- If a secret is ever committed, rotate/revoke it immediately. Removing it from the latest commit is not sufficient because Git history retains prior versions.

## Data protection

- Supabase Auth establishes the signed-in user.
- Household membership and owner/editor/viewer roles are enforced by PostgreSQL Row Level Security.
- Anonymous users receive no table grants or storage policies.
- Internal authorization helpers are kept in a non-exposed schema.
- Photos and documents use private buckets with household-prefixed object paths.
- Secret/service-role keys are reserved for trusted server-side administration and are never used by the PWA.

Report suspected exposure privately to the repository owner rather than opening a public issue containing sensitive material.
