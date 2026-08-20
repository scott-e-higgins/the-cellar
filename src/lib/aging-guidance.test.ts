import { describe, expect, it } from 'vitest'
import { guidanceSourceLabel, guidanceStatus, lotRequiresAgingConfirmation } from './aging-guidance'

describe('aging guidance', () => {
  it('uses clear status boundaries', () => {
    expect(guidanceStatus({ drinkWindowStartYear: 2028, drinkWindowEndYear: 2034 }, 2027)).toBe('Hold')
    expect(guidanceStatus({ drinkWindowStartYear: 2028, drinkWindowEndYear: 2034 }, 2028)).toBe('Drinking Well')
    expect(guidanceStatus({ drinkWindowStartYear: 2028, drinkWindowEndYear: 2034 }, 2033)).toBe('Drink Soon')
  })

  it('requires confirmation only when every available bottle in a lot is aging', () => {
    expect(lotRequiresAgingConfirmation({ normalQuantity: 0, agingQuantity: 1 })).toBe(true)
    expect(lotRequiresAgingConfirmation({ normalQuantity: 1, agingQuantity: 1 })).toBe(false)
  })

  it('labels estimates honestly', () => expect(guidanceSourceLabel('cellar_estimate')).toBe('Cellar estimate'))
})
