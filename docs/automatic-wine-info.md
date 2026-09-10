# Automatic Wine Info — v0.23.0

Add Wine / Add Wines & Bottles automatically calls the existing `enrich-record`
`preview_wine` action after one second of settled identity input: a selected or
inline-created winery, wine name, and a four-digit vintage (1800–2200). Explicit
Non-vintage also qualifies. Selecting an existing wine uses the same preview path.

Exact/high-confidence results without reported conflicts show “Wine info found ✓”.
Other usable matches show “Wine info needs review”, with the explanation, conflicts,
identity, and sources available before Use Info. No research is selected or applied
automatically. The existing save RPC receives an attempt ID only after Use Info;
manual/personal data and provenance remain separate. Existing Wine Detail's manual
Find Wine Info is unchanged.

Save, editing, and dismissal no longer wait for enrichment. No-match and failure
messages are inline and nonblocking. Manual Find Wine Info remains available and
can retry failures/no matches. An entry-session promise cache avoids duplicate
requests for unchanged identities, including identical lines. Identity-keyed views
ignore late results from edited/removed wines; leaving cancels pending debounce
work. Already-started server previews can finish, but cannot save or alter a wine
by themselves. Final save/photo retry and dirty-state completion paths are unchanged.

Validation: 147 Vitest tests, including 11 automatic lookup tests; production build,
PWA output verification, and two import tests passed. Cases cover missing identity,
debounce, inline winery selection, NV, existing wine, exact/ambiguous/no match,
manual retries, duplicate requests, stale results, leaving, explicit acceptance,
and Save while the response is pending. Existing acquisition/photo safety suites
also pass. Cloud browser tab discovery timed out twice, so live authenticated
click-through and native iPhone visual verification were not completed.

No schema, security, storage, dependency, or Edge Function changes.
