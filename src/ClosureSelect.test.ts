import { describe, expect, it } from 'vitest'
import { normalizeClosure } from './ClosureSelect'

describe('normalizeClosure', () => {
  it('keeps the closure choices limited to cork and screwtop', () => {
    expect(normalizeClosure()).toBe('Cork')
    expect(normalizeClosure('Natural cork')).toBe('Cork')
    expect(normalizeClosure('Screw cap')).toBe('Screwtop')
  })
})
