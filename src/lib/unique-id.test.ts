import { describe, expect, it } from 'vitest'
import { createUniqueId } from './unique-id'

describe('createUniqueId', () => {
  it('uses randomUUID when the browser provides it', () => {
    expect(createUniqueId({ randomUUID: () => 'native-id' })).toBe('native-id')
  })

  it('creates an RFC 4122 version 4 UUID when randomUUID is unavailable', () => {
    const id = createUniqueId({
      getRandomValues: ((values: Uint8Array) => {
        values.forEach((_, index) => { values[index] = index })
        return values
      }) as Crypto['getRandomValues'],
    })

    expect(id).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
  })
})
