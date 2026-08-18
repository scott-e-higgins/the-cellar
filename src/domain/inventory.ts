import type { InventoryBalance, InventoryMovement } from '../lib/types'

const keyFor = (purchaseItemId: string, storageLocationId: string) =>
  `${purchaseItemId}:${storageLocationId}`

export function deriveInventoryBalances(events: InventoryMovement[]): InventoryBalance[] {
  const balances = new Map<string, InventoryBalance>()

  const apply = (
    event: InventoryMovement,
    storageLocationId: string | null | undefined,
    quantity: number,
  ) => {
    if (!storageLocationId) return
    const key = keyFor(event.purchaseItemId, storageLocationId)
    const current = balances.get(key) ?? {
      purchaseItemId: event.purchaseItemId,
      wineId: event.wineId,
      storageLocationId,
      quantity: 0,
    }
    balances.set(key, { ...current, quantity: current.quantity + quantity })
  }

  [...events]
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id))
    .forEach((event) => {
      if (event.movementType === 'receive' || event.movementType === 'adjust_in') {
        apply(event, event.toLocationId, event.quantity)
        return
      }
      if (event.movementType === 'move') {
        apply(event, event.fromLocationId, -event.quantity)
        apply(event, event.toLocationId, event.quantity)
        return
      }
      apply(event, event.fromLocationId, -event.quantity)
    })

  return [...balances.values()]
    .filter((balance) => Math.abs(balance.quantity) > 0.0001)
    .sort((a, b) =>
      a.wineId.localeCompare(b.wineId) ||
      a.storageLocationId.localeCompare(b.storageLocationId),
    )
}

export function availableBottleCount(events: InventoryMovement[]): number {
  return deriveInventoryBalances(events).reduce((sum, balance) => sum + balance.quantity, 0)
}
