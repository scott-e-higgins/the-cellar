# Stabilization verification — v0.24.1

Initial main was `59c4a3dd4ee9cfda967c05e27d817f81cccc3343` (v0.23.1). During verification, main/deployment advanced to `7bf2c1614944fd07436ad2231dcda649ab093c27` (v0.24.0). The patch was rebased onto that current baseline, preserving its Travel Journal deep links and dependency update. This pass changes only defect recovery and More organization. No schema, RLS, authentication, enrichment-engine or production-data changes.

## Corrections

- Reproduced stale Aging form state after a collection refresh removed an Aging bottle. The controls now reinitialize when that wine's authoritative active bottle IDs/Aging/hold state changes. Unrelated refreshes and location-only moves preserve the form state.
- Visit editing previously reported total failure if the Visit update succeeded but the subsequent Trip-link update failed. It now validates a changed Trip before writing, closes the completed editor, and gives a persistent partial-success warning. Refresh failures retain both warnings.
- Open/Gift and shared Winery/Visit creation previously offered resubmission after an unconfirmed network outcome. They now freeze that submission and offer Refresh & Check, never another mutation. A confirmed SQL rejection still permits editing/retry. This does not claim server idempotency for the legacy departure endpoints: after an unknown outcome the user must inspect the refreshed record/history before making a new entry.
- A Travel Journal record link was prematurely marked handled after a failed initial collection load. It now waits for successful loading so Retry Refresh opens the intended record.
- More retains all nine destinations in three labeled groups: Bottles & storage, Our collection, Tools & records. No additional screens. Existing colors, touch controls, and navigation are preserved.

## Verification

- Baseline: 150 tests across 26 files passed.
- After rebase and fixes: 161 tests across 27 files passed. Eight added cases cover stale Aging after refresh, Visit/Trip partial success with/without refresh failure, lost Open/Visit/Gift acknowledgement, grouped More navigation, and linked-record load recovery. The incoming main branch added three deep-link parser/security tests.
- TypeScript/production build, PWA build verification, and two import tests passed.
- All seven existing database suites executed successfully against deployed Supabase in synthetic households with transaction rollback: pass2_workflows, pass3_workflows, pass4_workflows, pass4_gifts, manual_wine_and_moves, trip_reconciliation, inventory_audit.
- Database coverage includes acquisition/mixed lines/inline identities, stable retries, atomic rollback, individual later reviews, normal/Aging gifting, history correction, moves retaining physical IDs/holds/acquisition relationships, authoritative Trip inference/ambiguity, explicit-link protection, audit staging/resume/cancel/apply/idempotency, and viewer/cross-household restrictions.
- Existing component suites exercise acquisition defaults/Add Another, automatic/manual lookup and review, manual Edit, save/close/dirty-state, contextual Back/search/filter/sort, queue Accept/Skip, photo preview/upload/metadata retry/URL recovery, and inventory-audit journeys. These are jsdom simulations with mocked API responses, not live browser journeys.

## Production integrity

205 Wines, 213 Purchases, four Visits, 209 physical bottle records (205 active, two opened, two gifted), 247 movements, 48 Trip references, two photo metadata records. Before/after hashes of Wines, Purchases, Visits, bottles, movements, Trip references and photo records were identical after all rollback suites.

No discrepancies found for physical-versus-ledger quantities, negative balances, cross-household bottle relationships, manual Aging overrides, duplicate departure bottle IDs, duplicate purchase request IDs, duplicate Wine identities, duplicate Winery/date Visits, broken Trip IDs, missing stored photo objects, Gift/Opening history consistency, conflicting Purchase/Visit Trip links, linked purchase dates outside their Trip, or duplicate audit bottle adjustments. All Cellar tables have RLS. Current production audit history contains one cancelled audit; successful application was verified with rollback fixtures.

Project security advisors reported no Cellar-schema findings. Existing shared-project public-function advisories and disabled leaked-password protection were not changed in this scoped pass.

## Review scope and limits

Reviewed current Home, collection/cards/search, Wine/Winery Detail, acquisition and personal editing, Visit/purchase relationships, Open/Gift/later review, movement/Aging, enrichment, photos, Inventory Audit, History, More and shared overlay/completion implementation. The existing acquisition header, compact winery search, technical-information disclosure, and footer spacing were retained. More was the clear organizational problem; other screens were not redesigned.

The cloud browser could create a fresh tab, but tab discovery/navigation repeatedly failed with a CDP refresh-tabs timeout. Authenticated live UI journeys and visual desktop/mobile verification could not be completed in this environment. Production verification is deployment/build/public-asset verification plus the live database checks above. Native iPhone camera/library chooser, keyboard, safe-area/sticky-footer scrolling, and installed-PWA behavior still require device verification. No background blur or other features were added.
