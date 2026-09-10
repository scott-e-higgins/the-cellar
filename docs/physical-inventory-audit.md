# Physical Inventory Audit — v0.22.0

Open **More → Inventory Audit**, choose an existing location, count, review the exceptions, then Apply Audit. Rack, Wall, Chill and Phillis are independent. Search supports winery/wine/vintage; sorting is by winery or wine name. Important controls are at least 48px.

Correct counts take one confirmation. Missing bottles (including zero), extra bottles and Found Here/Move Here are observations until Apply. Reasons default to Not sure. Meaningfully different purchase dates, locations and Aging/Hold decisions get focused choices only when needed. Unknown differences create adjustments, never fabricated consumption or gifts.

Bottle Not Listed searches the existing collection first. A new wine uses the existing simplified entry and enrichment form in identity-only mode, then returns to the active count. Adding its Wine identity does not add physical inventory. Cancelling the audit preserves any separately saved Wine identity.

## Persistence and safety

`cellar.inventory_audits` stores the location snapshot, observations, revision, status and timestamps. One counting audit per household/location is enforced. Confirm and Save & Pause persist to Supabase; edits also have a household-scoped local draft for accidental screen closure. Search/selection changes within the workflow save changed observations first. Review only shows discrepancies and unconfirmed wines.

Apply is one transaction. Existing movement and bottle writers share a household inventory lock. The location snapshot and every incoming Move Here bottle must still match; otherwise Apply fails without adjustments and Refresh counts keeps unaffected confirmations while requiring affected wines to be recounted. Revision checks prevent one screen overwriting another. Request receipts protect acknowledgement-loss retries; completed Apply is a no-op on retry.

Only household editors may submit commands. Members can read results. Clients have INSERT access only to identity/location and UPDATE access only to the command column. A SECURITY INVOKER trigger owns snapshots, revisions and completion, so even direct Data API requests cannot forge a successful audit. All functions keep RLS and an empty search path.

## Inventory architecture

Moves reuse `move_physical_bottles`, retain physical bottle IDs, and retain all Aging, Hold, purchase and related history. Shortages mark selected bottles adjusted_out and add adjustment ledger entries. Excess bottles use audit-origin inventory lots (`purchase_items.inventory_audit_id`, no purchase_id) plus individual bottles and adjust_in ledger entries. They do not create Purchase records, acquisition dates or Trip links, and are excluded from Purchased statistics. They remain usable in the existing Gift/Open/Move/Aging flows.

Movement rows reference the audit. Audit adjustments appear in existing History. Completed results retain expected/actual counts and reasons. Another location's independent correction leaves a completed audit intact; later inventory movement into/out of a completed location is shown as changed since audit.

## Validation

- Vitest: existing regression suites plus focused audit journeys (136 tests total).
- Production TypeScript/Vite build and PWA checks.
- Authenticated SQL rollback tests: location scope; no inventory mutation while counting; shortage and Aging identity; baseline additions without purchases; Aging Move Here; correct ledger totals; repeat Apply; request retry; stale inventory/revision rejection; recovery/cancel; viewer/cross-household denial; direct completion forgery denied; Gift and Move on audit-origin bottles.
- Existing SQL acquisition and manual-Wine/Move regression suites run with the new schema inside rolled-back transactions.
- No real household location is declared physically audited by the implementation/testing process.
