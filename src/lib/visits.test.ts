import { describe, expect, it } from 'vitest'
import { EMPTY_CELLAR_DATA, type CellarData } from './cellar-data'
import { photosForVisit, tripForVisit, visitCanBeDeleted, winesForVisit } from './visits'

const data = {
  ...EMPTY_CELLAR_DATA,
  wines: [{ id: 'wine-1' }, { id: 'wine-2' }],
  purchases: [{ id: 'purchase-1', wineryVisitId: 'visit-1' }],
  purchaseItems: [{ id: 'item-1', purchaseId: 'purchase-1', wineId: 'wine-1' }],
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
})
