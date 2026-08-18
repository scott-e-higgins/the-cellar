# Spreadsheet import mapping checkpoint

Status: **waiting for the original spreadsheet**. No production import code or data conversion should begin before the file is supplied and this mapping is approved.

The repository includes `scripts/import_preview.py`, a read-only `.xlsx`/`.csv`/`.tsv` profiler. It does not connect to Supabase. When the original spreadsheet arrives, run:

```bash
python3 scripts/import_preview.py path/to/original.xlsx --output import-preview.json
```

The generated report contains detected column mapping, counts, reconciliation totals, and row-level exceptions. Source spreadsheets and preview reports remain gitignored.

## Proposed target mapping

| Source concept | Target | Import rule |
|---|---|---|
| Producer / winery | `wineries` | Normalize whitespace and case; flag uncertain duplicates for review |
| Wine name + vintage/NV | `wines` | Match within household and winery; do not create one wine per purchase row |
| Varietal / blend | `varietals`, `wine_varietals` | Split only when source semantics are clear; preserve ambiguous text in `blend_description` |
| Purchase date / place / buyer / selector | `purchases` | Group rows only when the source clearly identifies a single transaction |
| Quantity / unit price / total / value | `purchase_items` | Preserve original precision; flag conflicting totals |
| Current location | `storage_locations` + opening `receive` movement | Map values to approved location records; do not hard-code spreadsheet labels |
| Consumed/opened indicator | `openings` + `open` movement | Import only when dates and quantities can be reconciled; otherwise flag for review |
| Rating / notes / buy again | `tasting_reviews` or `wine_preferences` | Attribute to a household member only when explicit; do not guess |
| Winery visit | `winery_visits` | Keep visit date and visit-specific notes separate from the winery master |
| Photo / receipt reference | `photos` / `documents` | Import only when the original file is available and ownership is clear |
| Trip reference | `travel_references` | Optional; add only from an explicit external Travel Journal identifier |

## Required validation report

Before committing an import, produce counts for source rows, candidate wineries, candidate wines, purchases, purchase items, opening events, unmatched locations, ambiguous people, duplicate candidates, invalid dates, invalid quantities, and rows that would create negative inventory. The import remains a dry run until the household owner approves that report and the final column mapping.
