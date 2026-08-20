import { describe, expect, it } from 'vitest'
import { userError } from './user-error'

describe('userError', () => {
  it('turns internal schema errors into useful guidance', () => {
    expect(userError(new Error("Could not find the table 'cellar.wines' in the schema cache"))).toContain('temporarily unavailable')
  })

  it('preserves a useful validation message', () => {
    expect(userError(new Error('Choose a receipt or document.'))).toBe('Choose a receipt or document.')
  })
})
