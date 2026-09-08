# Pass 2 — everyday usability (v0.17.0)

Scope: approved Pass 2 only, based on main `555acff0dbd77ad21ddc5936e24bd834cd211c34` / v0.16.1.

## Workflows

- Add Wine keeps wine information and bottle acquisition in one form, with an explicit definition-only option.
- Add Bottles supports multiple lines and in-context new wine creation. Date, purchase details, visit and trip are shared. Matching wine identities are reused without overwriting their manual fields.
- Open Bottle defaults to Still open; tasting information is optional. Existing openings support Finish Bottle and editing individual ratings, notes, buy-again opinions and opening details.
- Winery Details presents Our Visits and Add Visit first, then Our Wines and producer/reference information.
- Contextual Open/Gift selection starts with that wine's lots, prefers a normal lot, displays location/date/Aging distinctions, and offers Change Wine.
- Manual Aging works without generated guidance and retains existing bottle overrides unless an override is explicitly entered.
- Accepted category/style supplies a sourced display/search/filter/statistics fallback. Manual values remain authoritative and are never written from this fallback.

## Database

Migration `20260908021352_pass2_everyday_workflows.sql` is backwards compatible with v0.16.1. It adds an optional purchase request identifier and unique index, an atomic acquisition RPC, an opening-review RPC, and removes the generated-guidance prerequisite from the existing Aging RPC. The acquisition transaction uses the existing purchase/inventory functions. Stable retry identifiers prevent duplicate purchase/inventory effects after an uncertain response. All new RPCs use invoker privileges, fixed search paths, household checks and existing RLS.

No existing collection values were backfilled or rewritten. No Travel Journal schema, authentication, or records were changed. Existing visible trips are read and Cellar references are maintained.

## Validation

- React form tests: new wine acquisition, definition-only, mixed purchase with missing wine, contextual defaults, uncertain retry with identical payload, save/refresh failure, normal lot preference, Open/Gift selection, Change Wine, later separate Scott/Kay reviews and half-rating preservation.
- Shell journeys: accepted classification display/search/filter and Back preservation; Aging without guidance and unsaved-edit protection; Winery → Visit → associated wines; Wine → History → Opening → Finish/rating/notes → Save → correctable saved review.
- Existing Pass 1 photo, save/retry, navigation, scroll, search, unsaved changes, camera/photo picker and other regression suites remain included.
- `supabase/tests/pass2_workflows.sql` passed against the active Cellar database. It creates a synthetic household, exercises the actual authenticated RPCs and rolls the entire transaction back. Assertions cover wine/purchase/inventory state, multiple lines, visit/trip links, idempotent retry, identity reuse, failed-line rollback, no-guidance Aging, overrides, normal bottle selection, finish/review without another decrement, and viewer rejection.
- TypeScript/production build, PWA artifact checks and import guardrail tests run before release.

## Verification limits

Live desktop/mobile-width browser journeys could not be completed: the cloud browser remained stuck on an earlier native confirmation dialog, and its documented dismissal control timed out. Responsive styles were reviewed, but that is not a substitute for rendered iPhone/PWA-width verification. Native installed-PWA behavior also remains device-unverified.

The shared project's security advisor reported no Cellar findings. It reported existing public-schema function-exposure notices and shared Auth leaked-password protection being disabled; those unrelated settings were not changed in this UX pass. References: [function exposure advisory](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
