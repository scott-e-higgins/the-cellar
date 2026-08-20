import type { BottleLot, DrinkingGuidanceRecord, GuidanceSource } from './cellar-data'

export type DrinkingStatus = 'Hold' | 'Drinking Well' | 'Drink Soon'

export function guidanceStatus(guidance: Pick<DrinkingGuidanceRecord, 'drinkWindowStartYear' | 'drinkWindowEndYear'>, currentYear = new Date().getFullYear()): DrinkingStatus | null {
  const { drinkWindowStartYear: start, drinkWindowEndYear: end } = guidance
  if (start != null && currentYear < start) return 'Hold'
  if (end != null && currentYear >= end - 1) return 'Drink Soon'
  if (start != null || end != null) return 'Drinking Well'
  return null
}

export function guidanceSourceLabel(source: GuidanceSource): string {
  return ({ producer: 'Producer guidance', professional: 'Professional guidance', wine_specific: 'Wine-specific guidance', cellar_estimate: 'Cellar estimate' })[source]
}

export function lotRequiresAgingConfirmation(lot: Pick<BottleLot, 'normalQuantity' | 'agingQuantity'> | undefined): boolean {
  return Boolean(lot && lot.normalQuantity === 0 && lot.agingQuantity > 0)
}
