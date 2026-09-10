# Manual Wine and physical bottle management — v0.20.0

Wine Edit now asks for identity, personal notes, favorites and household Buy Again/preferences. It saves those together in one transaction. Technical fields are neither submitted nor cleared. Previously recorded reference values remain readable on Detail; accepted online information retains its existing provenance and review workflow. Wine Edit no longer repeats the hero photo above its fields. Acquisition keeps its existing inline Winery, enrichment, Trip/Visit inference and Add Another flow, with only personal notes in its optional Wine details.

“In Our Cellar” shows counts by storage, including Aging counts, with Change Location. One available group needs only a destination; multiple bottles allow a quantity. Choices distinguish location, acquisition date/price and Aging/Hold. Equivalent bottles are grouped and normal bottles default first. Moving retains actual bottle IDs and only changes storage; purchases, photos, Visit/Trip relationships, Aging and Hold remain attached.

The additive migration creates an invoker move RPC, a nullable movement request receipt and unique index, plus an atomic personal Wine save RPC. The move validates household/editor access, active destination and expected source; locks physical bottles; updates ledger and storage in one transaction; and recognizes exact retries. It does not rewrite existing inventory or grant new table privileges. No Inventory Audit is included.

Gift/Open use the verified v0.19.1 completion guard and contextual selectors. Regression tests verify one mutation, refreshed inventory/history, automatic closure, and no false unsaved warning, including Gift corrections and last-bottle departures.

Validation:
- 119 Vitest tests, including full shell Wine Edit/Find Info/Accept/Move return journeys, dirty Back, failed save, successful save with refresh failure, exact move retries, Aging selection, and prior Pass 1–4 tests.
- Production build, PWA validation and two import guardrail tests.
- Authenticated SQL rollback tests for personal save, atomic preference failure, retained reference fields, one/several/Aging moves, stable bottle IDs/holds/purchases/Visit, retry idempotency, invalid destination/stale-source rollback, Gift after Move and viewer denial.
- Existing Pass 2, Pass 3, Pass 4 and Gift SQL suites passed with synthetic records rolled back.
- Existing ledger and physical bottle quantities reconcile: zero mismatched lots.
- Security advisor has no findings for these new functions; existing shared-public/Auth advisories remain outside this scope. See [Supabase database linter](https://supabase.com/docs/guides/database/database-linter) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Browser verification uses authenticated desktop Chrome. Responsive rules retain single-column forms at phone widths, comfortable targets and sticky headers. This browser exposes no supported viewport/device-emulation capability; native iPhone/PWA interaction remains unverified.
