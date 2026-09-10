# Pass 4 addendum — Gift / movement completion (v0.19.1)

## Cause and correction

Shared completion called contextual Back while the modal guard still reported
busy. Refresh could also remove/reorder an inventory choice after the saved
baseline was recorded, making a completed form look dirty. The shared guard now
recognizes a committed form, permits completion while refresh finishes, and
ignores refresh-driven field changes. A new user input/change starts a dirty draft
again. This applies to Gift/Open, Add Winery/Visit, record edits and other shared
successful-action flows, including saved-but-refresh-failed completion.

Wine Detail has separate Open Bottle and Gift Bottle actions. Gift starts directly
with recipient, today's editable date and optional note. It uses known Wine context,
selects a normal bottle first, and hides selection for one/equivalent choices.
Meaningful location/date/Aging distinctions remain selectable. Aging requires
explicit confirmation, without inventing a hold date. Opened/Gifted fields remain
independent and photo-only retry is preserved.

Existing Gift correction is enabled. The migration grants only recipient/date/note
updates and limits movement-date updates to movements belonging to household gifts.
No quantity/identity permissions, auth changes, or historical data rewrites occur.

## Verification

- 111 Vitest tests pass: existing regressions; full-shell last-bottle Gift/Open
  save → close → refreshed Wine → history → Back without a discard prompt;
  equivalent choices, normal/Aging preference, required confirmation, save failure,
  retry, no second submission after success, and Gift correction without inventory RPC.
- Shared guard tests cover busy completion, changed options after refresh, refresh
  failure, and subsequent real edits becoming dirty again.
- Authenticated-role SQL rollback test passes: exact one-bottle decrements, normal
  preference, Aging protection, failure rollback, Gift correction without new
  movements, column-level restrictions, gift-only movement date updates, viewer denial.
- Build, PWA output and two import guardrail tests pass.
- No Cellar security advisory returned after the migration.

Live browser verification requires a fresh secure sign-in in this session. Native
phone/PWA keyboard and camera behavior are not established by the automated suite.
