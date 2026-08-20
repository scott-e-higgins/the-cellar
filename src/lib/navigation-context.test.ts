import { describe, expect, it } from 'vitest'
import { nextRecordContext } from './navigation-context'

describe('record navigation context', () => {
  const saved = { scrollTop: 742, tab: 'details' as const }

  it('opens every forward record at the top', () => {
    expect(nextRecordContext({ previousDepth: 1, nextDepth: 2, saved, defaultTab: 'details' })).toEqual({ scrollTop: 0, tab: 'details' })
  })

  it('restores the prior position and tab when going back', () => {
    expect(nextRecordContext({ previousDepth: 2, nextDepth: 1, saved, defaultTab: 'details' })).toEqual(saved)
  })

  it('uses a safe top fallback when no prior context exists', () => {
    expect(nextRecordContext({ previousDepth: 2, nextDepth: 1, defaultTab: 'photos' })).toEqual({ scrollTop: 0, tab: 'photos' })
  })
})
