import { describe, expect, it } from 'vitest'
import { restoredManagementStack } from './overlay-history'

describe('overlay history restoration', () => {
  const wine = { kind: 'wine', id: 'wine-1' }

  it('restores the record stack for record navigation', () => {
    expect(restoredManagementStack({ type: 'management', stack: [wine] })).toEqual([wine])
  })

  it('keeps the launching record underneath a contextual action', () => {
    expect(restoredManagementStack({ type: 'action', underlayStack: [wine] })).toEqual([wine])
  })

  it('does not invent an underlying context for top-level actions', () => {
    expect(restoredManagementStack({ type: 'action' })).toEqual([])
  })
})
