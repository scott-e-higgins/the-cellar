# Pass 3 — v0.18.0

## Changes

Wine detail prioritizes inventory/storage, personal tasting experience and acquisition before drinking guidance and expandable producer material. Winery visits and wines precede actionable contact links and producer details. Cards keep the established record-opening interaction; detail photos keep their viewer/add-photo behavior. Empty placeholders, Home branding, touch targets and sticky detail navigation receive modest polish.

Search results distinguish matching records from collection totals; Clear Search, Clear Filters and Clear All have separate scopes. Small sort menus preserve their state through navigation. Enrichment rows identify winery/wine/vintage, support search, open directly at review and return to the preserved queue after Accept/Skip. General drinking estimates remain separate from bottle Aging and explicit Hold overrides.

Purchase corrections edit existing metadata and unlink/reassign visits. Likely matches use winery/date/trip context; mismatches require explicit confirmation and do not change dates. The correction RPC locks and updates existing records atomically without recreating quantities or inventory movements.

Photo selection previews the chosen file, retains camera/library choice, and optimizes large supported images to at most a 2560px long edge at JPEG quality 90 when smaller. Unsupported formats and decode failures retain the original. The existing stable photo task preserves retry safety. Signed URLs renew after 45 minutes/on resume; failed images trigger bounded automatic renewal and visible Retry Photos. Actionable save/refresh warnings remain persistent.

## Schema and pending permission

Applied: `20260908030823_pass3_history_corrections.sql`, a SECURITY INVOKER RPC with an empty search path, household editor checks and existing RLS. No existing records were rewritten. Shared authentication and Travel Journal schema/data are unchanged.

**Gift corrections are not enabled in the deployed UI.** Database testing showed gifts and movement dates are currently insert-only for authenticated clients. Automatic approval review rejected the necessary column grants and editor-only UPDATE policies, including after read-only checks confirmed RLS and the existing owner/editor gate. The proposed SQL is stored in `docs/pass3-pending-gift-permissions.sql`, outside migrations, and has NOT been applied. It requires explicit user approval for UPDATE of gifts_given(gifted_to,gifted_on,occasion_note) and inventory_movements(occurred_at), restricted to existing authorized household/app owners and editors. No quantity or identity update grant is proposed.

The Gift form code is unit-tested but remains unreachable from the deployed action controls until that permission is approved and its database integration test passes.

## Validation

- 90 Vitest tests, including all Pass 1/2 regression tests. New coverage: correction payloads, refresh-failure resubmission protection, date mismatch confirmation, clear/search/filter/sort Back context, queue Accept/Skip return context, contact precedence/URL safety, photo preview cleanup, optimization/fallback, failed URL recovery and 45-minute renewal.
- `supabase/tests/pass3_workflows.sql`: passed against the active database with a synthetic household and transaction ROLLBACK. Includes Pass 2 atomic acquisition/mixed lines/inline wine creation, trip links, idempotent retry, failed-line rollback, no-guidance Aging/overrides, normal bottle preference, later Scott/Kay review, plus Purchase correction/unlink/relink, mismatch rejection/confirmation, inventory preservation and viewer rejection. No existing collection records were changed.
- TypeScript and production build, PWA artifact verification, import guardrail tests, and git whitespace checks.
- Security advisor: no Cellar-schema findings. Existing shared public-schema/Auth notices remain outside this UX pass.

## Verification limits

The cloud browser API does not expose viewport/device emulation. Responsive styles and comfortable control sizes were reviewed, but native iPhone camera/library, installed-PWA and rendered mobile-width checks require device review. Gift correction integration remains blocked as explained above.
