import type { BottleLot, CellarData } from './cellar-data'
export function preferredLot(lots: BottleLot[], wineId?: string | null) {
  const relevant = wineId ? lots.filter((lot) => lot.wineId === wineId) : lots
  return relevant.find((lot) => lot.normalQuantity > 0 || lot.quantity > lot.agingQuantity) ?? relevant[0]
}
export function lotDescription(lot: BottleLot, data: Pick<CellarData, 'purchases'>) {
  const date = data.purchases.find((purchase) => purchase.id === lot.purchaseId)?.acquisitionDate
  return [lot.storageLocationName, date ? `Acquired ${date}` : null, `${lot.quantity} available`, lot.agingQuantity ? `${lot.agingQuantity} Aging${lot.earliestHoldUntilYear ? ` · hold ${lot.earliestHoldUntilYear}` : ''}` : null].filter(Boolean).join(' · ')
}
