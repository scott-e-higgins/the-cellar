import type { SupabaseClient } from '@supabase/supabase-js'
import type { Snapshot } from './types'

export interface WineRecord {
  id: string
  wineryId: string | null
  wineryName: string | null
  name: string
  vintage: number | null
  nonVintage: boolean
  style: string | null
  category: string | null
  favorite: boolean
  createdAt: string
  availableQuantity: number
}

export interface WineryRecord {
  id: string
  name: string
  region: string | null
  state: string | null
  country: string | null
  favorite: boolean
  wouldVisitAgain: 'yes' | 'maybe' | 'no' | null
  visitCount: number
}

export interface PersonOption {
  id: string
  displayName: string
}

export interface LocationOption {
  id: string
  name: string
}

export interface BottleLot {
  purchaseItemId: string
  wineId: string
  wineLabel: string
  storageLocationId: string
  storageLocationName: string
  quantity: number
}

export interface CellarData {
  snapshot: Snapshot
  wines: WineRecord[]
  wineries: WineryRecord[]
  people: PersonOption[]
  locations: LocationOption[]
  bottleLots: BottleLot[]
}

export const EMPTY_CELLAR_DATA: CellarData = {
  snapshot: { currentBottles: 0, recordedValue: 0, bottlesEnjoyed: 0, wineriesRepresented: 0 },
  wines: [],
  wineries: [],
  people: [],
  locations: [],
  bottleLots: [],
}

type QueryResult = { data: unknown; error: { message: string } | null; count?: number | null }

function requireResult<T>(result: QueryResult): T {
  if (result.error) throw new Error(result.error.message)
  return (result.data ?? []) as T
}

export async function loadCellarData(client: SupabaseClient, householdId: string): Promise<CellarData> {
  const [
    winesResult,
    wineriesResult,
    visitsResult,
    balancesResult,
    itemsResult,
    peopleResult,
    locationsResult,
    openingsResult,
  ] = await Promise.all([
    client.from('wines').select('id, winery_id, name, vintage, non_vintage, style, category, favorite, created_at').eq('household_id', householdId).order('created_at', { ascending: false }),
    client.from('wineries').select('id, name, region, state, country, favorite, would_visit_again').eq('household_id', householdId).order('name'),
    client.from('winery_visits').select('id, winery_id').eq('household_id', householdId),
    client.from('inventory_balances').select('purchase_item_id, wine_id, storage_location_id, quantity').eq('household_id', householdId),
    client.from('purchase_items').select('id, wine_id, unit_price, current_value_per_bottle').eq('household_id', householdId),
    client.from('people').select('id, display_name').eq('household_id', householdId).eq('is_active', true).order('display_name'),
    client.from('storage_locations').select('id, name').eq('household_id', householdId).eq('is_active', true).order('sort_order').order('name'),
    client.from('openings').select('id', { count: 'exact' }).eq('household_id', householdId),
  ])

  const wineRows = requireResult<Array<Record<string, unknown>>>(winesResult)
  const wineryRows = requireResult<Array<Record<string, unknown>>>(wineriesResult)
  const visitRows = requireResult<Array<Record<string, unknown>>>(visitsResult)
  const balanceRows = requireResult<Array<Record<string, unknown>>>(balancesResult)
  const itemRows = requireResult<Array<Record<string, unknown>>>(itemsResult)
  const peopleRows = requireResult<Array<Record<string, unknown>>>(peopleResult)
  const locationRows = requireResult<Array<Record<string, unknown>>>(locationsResult)
  requireResult(openingsResult)

  const wineryNames = new Map(wineryRows.map((row) => [String(row.id), String(row.name)]))
  const wineRowsById = new Map(wineRows.map((row) => [String(row.id), row]))
  const locationsById = new Map(locationRows.map((row) => [String(row.id), String(row.name)]))
  const itemsById = new Map(itemRows.map((row) => [String(row.id), row]))
  const quantityByWine = new Map<string, number>()

  for (const row of balanceRows) {
    const wineId = String(row.wine_id)
    quantityByWine.set(wineId, (quantityByWine.get(wineId) ?? 0) + Number(row.quantity ?? 0))
  }

  const wines: WineRecord[] = wineRows.map((row) => ({
    id: String(row.id),
    wineryId: row.winery_id ? String(row.winery_id) : null,
    wineryName: row.winery_id ? wineryNames.get(String(row.winery_id)) ?? null : null,
    name: String(row.name),
    vintage: row.vintage === null ? null : Number(row.vintage),
    nonVintage: Boolean(row.non_vintage),
    style: row.style ? String(row.style) : null,
    category: row.category ? String(row.category) : null,
    favorite: Boolean(row.favorite),
    createdAt: String(row.created_at),
    availableQuantity: quantityByWine.get(String(row.id)) ?? 0,
  }))

  const visitsByWinery = new Map<string, number>()
  for (const row of visitRows) {
    const wineryId = String(row.winery_id)
    visitsByWinery.set(wineryId, (visitsByWinery.get(wineryId) ?? 0) + 1)
  }

  const wineries: WineryRecord[] = wineryRows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    region: row.region ? String(row.region) : null,
    state: row.state ? String(row.state) : null,
    country: row.country ? String(row.country) : null,
    favorite: Boolean(row.favorite),
    wouldVisitAgain: row.would_visit_again as WineryRecord['wouldVisitAgain'],
    visitCount: visitsByWinery.get(String(row.id)) ?? 0,
  }))

  const recordedValue = balanceRows.reduce((total, balance) => {
    const item = itemsById.get(String(balance.purchase_item_id))
    const value = Number(item?.current_value_per_bottle ?? item?.unit_price ?? 0)
    return total + Number(balance.quantity ?? 0) * value
  }, 0)

  const represented = new Set(
    wines.filter((wine) => wine.availableQuantity > 0 && wine.wineryId).map((wine) => wine.wineryId),
  ).size

  const bottleLots: BottleLot[] = balanceRows
    .filter((row) => Number(row.quantity ?? 0) > 0)
    .map((row) => {
      const wine = wineRowsById.get(String(row.wine_id))
      const winery = wine?.winery_id ? wineryNames.get(String(wine.winery_id)) : null
      const vintage = wine?.non_vintage ? 'NV' : wine?.vintage ?? ''
      return {
        purchaseItemId: String(row.purchase_item_id),
        wineId: String(row.wine_id),
        wineLabel: [winery, vintage, wine?.name].filter(Boolean).join(' · '),
        storageLocationId: String(row.storage_location_id),
        storageLocationName: locationsById.get(String(row.storage_location_id)) ?? 'Unknown location',
        quantity: Number(row.quantity),
      }
    })
    .sort((a, b) => a.wineLabel.localeCompare(b.wineLabel) || a.storageLocationName.localeCompare(b.storageLocationName))

  return {
    snapshot: {
      currentBottles: [...quantityByWine.values()].reduce((sum, value) => sum + value, 0),
      recordedValue,
      bottlesEnjoyed: openingsResult.count ?? 0,
      wineriesRepresented: represented,
    },
    wines,
    wineries,
    people: peopleRows.map((row) => ({ id: String(row.id), displayName: String(row.display_name) })),
    locations: locationRows.map((row) => ({ id: String(row.id), name: String(row.name) })),
    bottleLots,
  }
}
