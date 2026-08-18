# Data-integrity decisions

These choices implement the brief's guardrails and should be reviewed before production records are imported.

1. **Wine identity is separate from acquisition.** One `wines` row represents a wine/vintage. Every acquisition is a separate `purchases` + `purchase_items` event, preserving date, price, buyer, selector, and receipt.
2. **Inventory is a ledger.** Current stock is calculated from movements. Edits do not silently replace acquisition or opening history.
3. **History blocks destructive parent deletion.** A winery, person, visit, wine, purchase item, location, or opening referenced by permanent history cannot be deleted until the reference is resolved intentionally. Normal UI behavior should archive/deactivate where available.
4. **Opening is an event.** Removing a bottle from inventory creates an `openings` row and an `open` movement in one database transaction. Individual household-member reviews remain separate.
5. **Corrections are explicit.** Discrepancies use `adjust_in` or `adjust_out` with a reason; they do not rewrite prior movements.
6. **Storage is configurable.** The example locations are initial rows only. Additional nested areas can be added without a schema change.
7. **Travel links are optional.** No Cellar record requires a Travel Journal ID. External links can be added later without changing inventory semantics.
8. **Media is private.** File metadata lives in relational tables; binary files are stored in private, household-prefixed object paths.

## Transaction requirements for workflow implementation

- Receive purchase: insert purchase, items, and receive movements atomically.
- Move wine: validate sufficient balance at the source, then insert a movement atomically.
- Open wine: validate sufficient balance, insert opening and open movement atomically.
- Adjust inventory: require a reason and prevent a resulting negative location balance.
- Delete actions: prefer archive/deactivate; expose a destructive delete only for unreferenced mistakes and require confirmation.
