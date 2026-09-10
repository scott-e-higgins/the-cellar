# Add Visit consistency — v0.24.2

Based on v0.24.1 (`ca5dd487`). Add Wine and Add Visit now use the same compact WineryPicker: no empty-query list, up to three matches, inline name/location creation, and results collapse on selection. Add Visit retains Winery Detail context and uses the same date-containment helper as acquisition entry.

A single exact Trip date match is selected automatically; no match stays unlinked; overlapping matches require an explicit choice or explicit No linked trip. Manual choices survive date/Winery changes until Use date match is selected. Trip controls are secondary unless ambiguous.

`cellar.save_winery_visit` is an additive SECURITY INVOKER function using existing editor checks/RLS. It saves optional inline Winery creation, Visit, and authoritative Trip link in one transaction. It reuses a single matching Winery name and guards duplicate requests with the client request ID. It calls the existing infer_acquisition_trip logic for automatic matches; manual selections must reference a visible authoritative Trip. No tables or existing records were changed. Photo validation precedes the mutation; photo upload/retry remains separate and cannot duplicate the Visit.

Verification:
- 167 tests across 28 files passed, including new global/contextual Add Visit, empty Winery collection/inline creation, one/no/overlapping Trip matches, explicit unlinked/manual preservation, and failed-save retry cases.
- Existing Add Wine picker/enrichment/acquisition, Visit photo failure/retry, contextual Back/scroll, save completion and unsaved-change suites passed after shared-component extraction.
- TypeScript production build and PWA output verification passed.
- New database suite passed before and after migration, using synthetic records and ROLLBACK: inline/existing Winery, exact/no/overlapping dates, manual choices, duplicate request replay, failed-save rollback, viewer and cross-household restrictions.
- Verified function is not SECURITY DEFINER, is unavailable to anon, and requires existing editor authorization for authenticated callers.
- No real inventory was changed. Native iPhone and live browser visual validation remain unverified because of the previously observed cloud browser connection timeout.
