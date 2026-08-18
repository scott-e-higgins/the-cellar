export type NavView = 'home' | 'cellar' | 'wineries' | 'more'

export type QuickAction =
  | 'add-wine'
  | 'record-purchase'
  | 'open-bottle'
  | 'add-winery'
  | 'add-winery-visit'

export interface Snapshot {
  currentBottles: number
  recordedValue: number
  bottlesEnjoyed: number
  wineriesRepresented: number
}

export interface HouseholdContext {
  householdId: string
  role: 'owner' | 'editor' | 'viewer'
  displayName: string
}

export interface InventoryMovement {
  id: string
  purchaseItemId: string
  wineId: string
  movementType: 'receive' | 'move' | 'open' | 'adjust_in' | 'adjust_out'
  quantity: number
  fromLocationId?: string | null
  toLocationId?: string | null
  occurredAt: string
}

export interface InventoryBalance {
  purchaseItemId: string
  wineId: string
  storageLocationId: string
  quantity: number
}
