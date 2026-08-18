import { describe, expect, it } from 'vitest'
import { availableBottleCount, deriveInventoryBalances } from './inventory'
import type { InventoryMovement } from '../lib/types'

const event = (
  id: string,
  movementType: InventoryMovement['movementType'],
  quantity: number,
  fromLocationId?: string,
  toLocationId?: string,
): InventoryMovement => ({
  id,
  purchaseItemId: 'purchase-item-1',
  wineId: 'wine-1',
  movementType,
  quantity,
  fromLocationId,
  toLocationId,
  occurredAt: `2026-08-18T12:00:0${id}Z`,
})

describe('inventory ledger', () => {
  it('derives balances from receipts, moves, openings, and adjustments', () => {
    const events = [
      event('1', 'receive', 6, undefined, 'rack'),
      event('2', 'move', 2, 'rack', 'chill'),
      event('3', 'open', 1, 'chill'),
      event('4', 'adjust_out', 1, 'rack'),
    ]

    expect(deriveInventoryBalances(events)).toEqual([
      expect.objectContaining({ storageLocationId: 'chill', quantity: 1 }),
      expect.objectContaining({ storageLocationId: 'rack', quantity: 3 }),
    ])
    expect(availableBottleCount(events)).toBe(4)
  })

  it('keeps repeated purchases separate by purchase item', () => {
    const first = event('1', 'receive', 2, undefined, 'rack')
    const second = {
      ...event('2', 'receive', 3, undefined, 'rack'),
      purchaseItemId: 'purchase-item-2',
    }

    expect(deriveInventoryBalances([first, second])).toHaveLength(2)
    expect(availableBottleCount([first, second])).toBe(5)
  })
})
