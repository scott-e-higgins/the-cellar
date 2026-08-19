import { describe, expect, it } from 'vitest'
import { automaticAcceptance, sanitizeData } from '../../supabase/functions/_shared/enrichment'

const officialSource = [{ source_type: 'producer_technical_sheet', exact_match: true }]
const exactResult = { confidence: 'high', match_type: 'exact', exact_name: true, exact_producer: true, exact_vintage: true, conflicts: [] }

describe('enrichment safety rules', () => {
  it('auto-accepts only exact, conflict-free primary-source vintage matches', () => {
    expect(automaticAcceptance('wine', { vintage: 2023 }, exactResult, officialSource)).toBe(true)
    expect(automaticAcceptance('wine', { vintage: 2023 }, { ...exactResult, exact_vintage: false }, officialSource)).toBe(false)
    expect(automaticAcceptance('wine', { vintage: 2023 }, { ...exactResult, conflicts: [{ field: 'vintage' }] }, officialSource)).toBe(false)
    expect(automaticAcceptance('wine', { vintage: 2023 }, exactResult, [{ source_type: 'retailer', exact_match: true }])).toBe(false)
  })

  it('allows exact official winery matches without a vintage requirement', () => {
    expect(automaticAcceptance('winery', {}, { ...exactResult, exact_vintage: null }, [{ source_type: 'official_winery', exact_match: true }])).toBe(true)
  })

  it('drops unsupported and empty provider fields before storage', () => {
    expect(sanitizeData('wine', { official_name: 'Example', description: '', personal_notes: 'must never pass', varietals: [] })).toEqual({ official_name: 'Example' })
  })
})
