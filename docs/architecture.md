# Architecture decision record

## Boundaries

The Cellar is an independent application, public repository, deployment, and Supabase project. The public-repository choice matches the existing Travel Journal setup. The Travel Journal was inspected read-only for interaction patterns; it is not a dependency and will not be modified.

Optional Travel Journal links are stored as `travel_references` containing an external system, entity type, external ID, label, and deep-link path. This keeps integration one-way and deferrable.

## Application

The client is a React + TypeScript single-page PWA built by Vite. It uses five primary destinations from the brief: Home, Cellar, Add, Wineries, and More. The shell accounts for phone safe areas, landscape use, installability, and explicit update prompts.

Authentication uses Supabase email/password sessions. Household membership is the tenant boundary; owner, editor, and viewer roles are enforced in Row Level Security rather than only in the UI.

## Relational model

| Area | Tables | Purpose |
|---|---|---|
| Access | `households`, `household_members`, `people` | Private tenancy, roles, and household-member identities used by tasting history |
| Wine catalog | `wineries`, `wines`, `varietals`, `wine_varietals` | Reusable wine identity and blend composition |
| Acquisition | `purchases`, `purchase_items` | Permanent transaction history; repeat purchases reference the existing wine |
| Inventory | `storage_locations`, `inventory_movements` | Configurable locations and an auditable bottle ledger |
| Experience | `winery_visits`, `openings`, `tasting_reviews`, `wine_preferences` | Visit history, bottle-opening events, individual reviews, and durable preferences |
| Media | `photos`, `documents` | Private label/visit/opening imagery and receipts |
| Integration | `travel_references` | Optional, non-owning links to external Travel Journal records |

## Inventory ledger

`inventory_movements` is the source of truth. Each row is one of:

- `receive`: adds bottles from a purchase item to a location;
- `move`: subtracts from one location and adds to another;
- `open`: subtracts from a location and links to a permanent opening event;
- `adjust_in` or `adjust_out`: explicit corrections with a reason.

The `inventory_balances` and `wine_inventory_summary` views derive current stock. No workflow updates a mutable “bottles on hand” field, so the history that produced a balance remains inspectable.

## Security

- Every household-owned table has RLS enabled.
- Data API grants are explicit and limited to authenticated users; `anon` receives no table access.
- Members can read; owners and editors can write; viewers cannot write.
- Cross-household references use composite foreign keys containing `household_id`.
- `cellar-photos` and `cellar-documents` are private buckets.
- Storage policies require the first path segment to be the caller's household UUID.
- Internal authorization helpers live in a non-exposed `private` schema.
- Only the Supabase publishable key is used in the PWA. Secret and service-role keys never enter the repository or browser.
- Production records, media, receipts, exports, and populated environment files are excluded from the repository.

## Deployment

GitHub Actions uses current Node 24-compatible action majors to run tests and build the static PWA from the public repository. GitHub Pages serves the resulting `dist` artifact. Supabase remains the independent authenticated data and file service; public access to the application shell does not grant access to household data.
