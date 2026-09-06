import { describe, expect, it } from 'vitest'
import { EMPTY_CELLAR_DATA, type CellarData } from './cellar-data'
import { bottlesPurchasedForVisit, photosForVisit, tripForVisit, unlinkedPurchasesForVisit, visitCanBeDeleted, winesForVisit } from './visits'

const data = {
  ...EMPTY_CELLAR_DATA,
  wines: [{ id: 'wine-1', wineryId: 'winery-1' }, { id: 'wine-2', wineryId: 'winery-1' }],
  purchases: [{ id: 'purchase-1', wineryVisitId: 'visit-1', acquisitionType: 'purchased', acquisitionDate: '2026-05-24' }, { id: 'purchase-2', wineryVisitId: null, acquisitionType: 'purchased', acquisitionDate: '2026-05-25' }],
  purchaseItems: [{ id: 'item-1', purchaseId: 'purchase-1', wineId: 'wine-1', quantity: 2 }, { id: 'item-2', purchaseId: 'purchase-2', wineId: 'wine-2', quantity: 1 }],
  photos: [{ id: 'photo-1', wineryVisitId: 'visit-1' }, { id: 'photo-2', wineryVisitId: 'visit-2' }],
  trips: [{ id: 'trip-1', name: 'Finger Lakes' }],
  travelReferences: [{ id: 'reference-1', wineryVisitId: 'visit-1', externalId: 'trip-1' }],
} as unknown as CellarData

describe('winery visit relationships', () => {
  it('keeps photos isolated to their visit', () => {
    expect(photosForVisit(data, 'visit-1').map((photo) => photo.id)).toEqual(['photo-1'])
  })

  it('resolves the authoritative trip without duplicating it', () => {
    expect(tripForVisit(data, 'visit-1')?.name).toBe('Finger Lakes')
  })

  it('finds wines through visit purchases', () => {
    expect(winesForVisit(data, 'visit-1').map((wine) => wine.id)).toEqual(['wine-1'])
  })

  it('protects visits that have purchase history', () => {
    expect(visitCanBeDeleted(data, 'visit-1')).toBe(false)
    expect(visitCanBeDeleted(data, 'visit-2')).toBe(true)
  })

  it('counts bottles and suggests relevant unlinked purchases', () => {
    expect(bottlesPurchasedForVisit(data, 'visit-1')).toBe(2)
    expect(unlinkedPurchasesForVisit(data, { id: 'visit-1', wineryId: 'winery-1', visitDate: '2026-05-24' } as never).map((purchase) => purchase.id)).toEqual(['purchase-2'])
  })
})
