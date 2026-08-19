import { describe, expect, it } from 'vitest'
import { US_STATES } from './StateSelect'

describe('US_STATES', () => {
  it('contains each of the 50 states exactly once', () => {
    expect(US_STATES).toHaveLength(50)
    expect(new Set(US_STATES.map(([code]) => code)).size).toBe(50)
    expect(new Set(US_STATES.map(([, name]) => name)).size).toBe(50)
  })
})
