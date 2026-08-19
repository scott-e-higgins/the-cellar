# Online enrichment

The Cellar keeps online facts separate from household-authored notes and history.

## Data model

- `enrichment_attempts` records every lookup outcome, confidence, proposed values, conflicts, provider usage, failures, and review state.
- `enrichment_sources` records source name, URL, source class, retrieval time, exact-match flag, and contributed fields.
- `wine_online_info` and `winery_online_info` contain only the currently accepted online snapshot and point back to the accepted attempt.
- Personal wine notes, ratings, favorites, purchases, gifts, openings, storage, and visit notes are never written by enrichment.

All four tables use household RLS. Accept/reject RPCs require an authenticated editor/owner and re-check household authorization inside the function. The Edge Function also requires a valid JWT, checks household role, and applies per-household minute/day limits.

## Confidence and acceptance

High-confidence auto-acceptance requires an exact identity, an exact vintage when vintage-specific information is claimed, no conflicts, and an exact primary/official source. Medium, low, ambiguous, general-vintage, and conflicting results remain in **Ready for Review**.

No-match results are remembered. Normal detail-page loads read stored Supabase rows and never perform live web searches.

## Cost controls

The default small model uses low search context. Each record is searched once unless Refresh/Retry is requested. Batch calls process at most five records, stop after a bounded collection pass, and respect daily/minute attempt limits.

## Provider setup

Set these only as Supabase Edge Function secrets:

- `OPENAI_API_KEY` — required.
- `ENRICHMENT_MODEL` — optional; defaults to `gpt-5.6-luna`.

The API key must never be committed or exposed through a `VITE_*` variable.
