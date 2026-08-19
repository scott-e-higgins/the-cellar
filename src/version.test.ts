import { describe, expect, it } from 'vitest'
import { APP_VERSION } from './version'

describe('application version', () => {
  it('uses semantic versioning', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
