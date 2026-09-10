import type { BottleRecord, CellarData } from './cellar-data'

export interface MoveGroup {
  key: string
  locationId: string
  label: string
  aging: boolean
  bottles: BottleRecord[]
}

// Group choices people can distinguish. The actual bottle IDs always retain
// their individual purchase, Aging, and history relationships through a move.
export function bottleMoveGroups(data: CellarData, wineId: string): MoveGroup[] {
  const groups = new Map<string, MoveGroup>()
  for (const bottle of data.bottles) {
    if (bottle.wineId !== wineId || bottle.status !== 'active') continue
    const item = data.purchaseItems.find(item => item.id === bottle.purchaseItemId)
    const purchase = data.purchases.find(purchase => purchase.id === item?.purchaseId)
    const acquired = purchase?.acquisitionDate
    const key = JSON.stringify([bottle.storageLocationId, acquired, item?.unitPrice, bottle.isAging, bottle.userHoldUntilYear, bottle.effectiveHoldUntilYear])
    if (!groups.has(key)) {
      const label = [
        data.locations.find(location => location.id === bottle.storageLocationId)?.name ?? 'Current storage',
        acquired ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${acquired}T12:00:00`)) : null,
        item?.unitPrice != null ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item.unitPrice) : null,
        bottle.isAging ? `Aging${bottle.effectiveHoldUntilYear ? ` · Hold ${bottle.effectiveHoldUntilYear}` : ''}` : null,
      ].filter(Boolean).join(' · ')
      groups.set(key, { key, locationId: bottle.storageLocationId, label, aging: bottle.isAging, bottles: [] })
    }
    groups.get(key)!.bottles.push(bottle)
  }
  return [...groups.values()].sort((a, b) => Number(a.aging) - Number(b.aging) || a.label.localeCompare(b.label))
}
