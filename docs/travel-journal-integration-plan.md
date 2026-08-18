# Travel Journal integration plan

Status: planned separately after Cellar v1 stability. This document authorizes no Travel Journal changes.

## Safe boundary

- Travel Journal remains authoritative for trips; Cellar never copies full trip records.
- Cellar stores only `external_system`, entity type, stable external ID, display label, and optional deep-link path in `travel_references`.
- Purchases, winery visits, and openings can each have an optional trip reference.
- Both apps remain independently deployable and usable if the other app is unavailable.

## Controlled implementation sequence

1. Confirm a stable Travel Journal trip identifier and deep-link route without modifying trip identity.
2. Add a read-only trip picker/API contract for authenticated members of the same future Higgs Home household.
3. Resolve shared identity explicitly; do not infer membership from email or editable user metadata.
4. Add Cellar links such as “Purchased during Finger Lakes 2025” and “View Trip.”
5. In a separate Travel Journal change, add read-only wine/winery references back to Cellar.
6. Test authorization failures, missing/deleted trips, stale labels, and both apps operating independently.

No cross-app secrets belong in either public repository. Any future server-to-server credential must remain in a protected runtime secret store.
