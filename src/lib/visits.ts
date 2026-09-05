import type { CellarData, TripRecord, WineRecord } from './cellar-data'

export function photosForVisit(data: CellarData, visitId: string) {
  return data.photos.filter((photo) => photo.wineryVisitId === visitId)
}

export function tripForVisit(data: CellarData, visitId: string): TripRecord | null {
  const reference = data.travelReferences.find((item) => item.wineryVisitId === visitId)
  return reference ? data.trips.find((trip) => trip.id === reference.externalId) ?? null : null
}

export function winesForVisit(data: CellarData, visitId: string): WineRecord[] {
  const purchaseIds = new Set(data.purchases.filter((purchase) => purchase.wineryVisitId === visitId).map((purchase) => purchase.id))
  const wineIds = new Set(data.purchaseItems.filter((item) => purchaseIds.has(item.purchaseId)).map((item) => item.wineId))
  return data.wines.filter((wine) => wineIds.has(wine.id))
}

export function visitCanBeDeleted(data: CellarData, visitId: string) {
  return !data.purchases.some((purchase) => purchase.wineryVisitId === visitId)
}
