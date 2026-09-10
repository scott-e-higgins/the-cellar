import { expect, it } from 'vitest'
import { parseCellarDeepLink, safeTravelReturnUrl } from './deep-links'

const visitId = 'c2c96a71-2a9c-44b7-82ec-20c665752162'
const wineId = '06e77eaa-b0f5-47cf-97ff-7973964ea4d6'

it('parses visit and wine links', () => {
  expect(parseCellarDeepLink(`?visit=${visitId}`, 'https://cellar.higgshome.com')).toMatchObject({ kind: 'visit', id: visitId })
  expect(parseCellarDeepLink(`?wine=${wineId}`, 'https://cellar.higgshome.com')).toMatchObject({ kind: 'wine', id: wineId })
})

it('accepts only known Travel Journal return locations', () => {
  const travel = `https://travel.higgshome.com/?trip=${visitId}`
  expect(safeTravelReturnUrl(travel, 'https://cellar.higgshome.com')).toBe(travel)
  expect(safeTravelReturnUrl('https://evil.example/?trip=anything', 'https://cellar.higgshome.com')).toBeNull()
  expect(safeTravelReturnUrl('javascript:alert(1)', 'https://cellar.higgshome.com')).toBeNull()
})

it('rejects ambiguous and malformed record targets', () => {
  expect(parseCellarDeepLink(`?visit=${visitId}&wine=${wineId}`, 'https://cellar.higgshome.com')).toBeNull()
  expect(parseCellarDeepLink('?wine=not-a-uuid', 'https://cellar.higgshome.com')).toBeNull()
})
