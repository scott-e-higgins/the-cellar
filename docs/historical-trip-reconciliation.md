# Historical Trip reconciliation — v0.21.0

Executed against existing adventure-hub records on September 10, 2026.

| Result | Acquisitions |
| --- | ---: |
| Examined | 213 |
| Already linked, preserved | 11 |
| Auto-linked from attached Winery Visit | 0 |
| Auto-linked from exact Trip-date match | 33 |
| Auto-linked from independently shared Visit context | 0 |
| Suggested / Needs Review | 1 |
| No matching Trip | 22 |
| Insufficient information | 146 |

The one near-date suggestion is Krug Champagne, acquired November 5, 2022, two days before the authoritative Honeymoon Trip (November 7–18). It was deliberately left unlinked. No suspicious existing Purchase or Visit links were found. No current purchases had an attached Visit; missing dates and lack of a trustworthy shared-event key cannot be resolved from winery geography or import timestamps.

More → Trip Links presents the categories, wine/vintage/winery/date, plausible Trips and reasons. Accept Suggested Trip, Choose Different Trip and Leave Unlinked affect the acquisition relationship only. Existing links are protected even if another person links a Purchase while a review screen is open. Leave Unlinked decisions persist across automatic reruns. Purchase Detail displays its linked Trip.

The additive schema contains reconciliation decision receipts and invoker functions. Authoritative Trips stay in public; purchase relationships remain in the existing cellar.travel_references table. No duplicate Wines, Purchases or Trips are created. No physical-bottle Trip IDs were added.

Historical matching and future save_wine_entry now share infer_acquisition_trip: linked Visit first, then exactly one inclusive Trip date range; ambiguous/unavailable Visit links require review. Near dates only suggest. A shared, explicitly associated Visit may independently establish an event; winery/date/location alone is not used to invent a shared batch. The browser entry preview also refuses multiple conflicting Visit Trip links.

Execution: scripts/reconcile_historical_trips.sql uses authenticated household access, stable acquisition locks, before/after fingerprints and exact preservation of all prior travel-reference rows. It added 33 links. Repeating the operation inside the same transaction added zero. Wine/Winery/Purchase/Visit data, quantities, physical bottles/storage/Aging, movements, gifts/openings, photos/documents, preferences/reviews, accepted information/guidance and Travel Journal Trips were unchanged.

Validation: 125 application tests; production and PWA builds; authenticated rollback SQL tests for exact boundaries, Visit inheritance with missing date, shared Visit context, overlap and conflicting links, near-date review, missing dates, existing-link warnings/preservation, manual decisions, retries, Leave Unlinked persistence, household/viewer protection; existing Pass 4 acquisition SQL suite passed. Security advisors have no findings for these new functions/table. Existing unrelated shared-project advisories remain outside scope ([database linter](https://supabase.com/docs/guides/database/database-linter), [Auth password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)).

Inventory Audit is not included. An incomplete collection is expected; no missing historical acquisitions were recreated.
