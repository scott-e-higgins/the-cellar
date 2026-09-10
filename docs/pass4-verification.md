# Pass 4 — Wine entry (v0.19.0)

The acquisition form now handles inline winery creation, existing/new wine identity,
unsaved-wine research through the existing enrichment service, quantities, date,
automatic Trip/Visit relationships, storage and optional price/photo in one place.
Global, Winery, Visit and Purchase entry points use the same form. Add Another
appends to the saved purchase, retaining its relationships and storage context.
Successful saves explicitly close the completed form; unknown-response retries
reuse the request and photo failures retry only the attachment.

## Database and service changes

- `20260910011339_pass4_wine_entry.sql`: atomic SECURITY INVOKER orchestration over
  the existing acquisition primitives; draft enrichment identity; append request IDs.
- `20260910012801_pass4_entry_receipts.sql`: ordered response receipts preserve
  the correct first-wine photo target after a lost multi-line response.
- Existing household RLS and caller privileges remain enforced. No records are
  migrated/deleted and no Travel Journal schema changes are required.
- `enrich-record` adds preview_wine using the existing provider, schema, sources,
  rate limits and explicit acceptance path. JWT validation remains enabled.
  Two deployed batch safeguards absent from Git main (job ownership and distinct
  attempted-record counting) are retained in the reconciled source.

## Verification

- 101 Vitest tests passed, including the existing Pass 1–3 regressions and new
  form/shell journeys for inline creation, exact/ambiguous research review,
  identity invalidation, Trip overlap/manual unlink, safe retries, photo failure,
  successful closure and Add Another context.
- Pass 2, 3 and 4 SQL suites passed under authenticated household roles. Synthetic
  test writes were rolled back. Coverage includes atomic mixed purchases,
  normal/Aging selection, later individual reviews, correction/linking, viewer
  protection, Trip/Visit inference, ambiguous Visit rollback, sourced acceptance,
  stale identity rejection, append totals and ordered response replay.
- Production build, PWA output verification and two import guardrail tests passed.
- No Cellar security advisory was returned after the migrations.

The automated research tests use controlled exact/ambiguous provider responses.
Authenticated live research and the final visual phone-width walkthrough still
require browser sign-in; the available cloud session was logged out at release.
Native iPhone camera/keyboard and installed-PWA behavior are not device-tested.
