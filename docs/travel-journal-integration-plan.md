# Travel Journal integration plan

Status: implemented in Cellar v0.24.0 and Travel Journal v1.2.0.

## Safe boundary

- Travel Journal remains authoritative for trips; Cellar never copies full trip records.
- Cellar stores only `external_system`, entity type, stable external ID, display label, and optional deep-link path in `travel_references`.
- Purchases, winery visits, and openings can each have an optional trip reference.
- Both apps remain independently deployable and usable if the other app is unavailable.

## Implemented behavior

1. `public.get_trip_cellar_activity(uuid)` exposes only the minimal read-only card data for a Travel trip.
2. The function runs as the signed-in user, so Travel trip RLS and Cellar household RLS both have to allow the request.
3. Travel shows **Wine & Wineries** only when the trip has linked Cellar activity.
4. Visit and wine cards deep-link to the exact Cellar record using UUIDs.
5. Cellar validates the optional return URL against known Travel Journal origins before using it.
6. The Family Viewer is excluded at both the Travel client and Supabase authorization layers.

The integration does not copy trip, wine, winery, visit, purchase, or photo records. Both apps remain independently usable if the other app is unavailable.

No cross-app secrets belong in either public repository. Any future server-to-server credential must remain in a protected runtime secret store.
