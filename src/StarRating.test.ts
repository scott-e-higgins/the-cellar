import { describe, expect, it } from 'vitest'
import { clampRating, starFill } from './StarRating'

describe('star ratings', () => {
  it('preserves fractional stored ratings when displaying stars', () => {
    expect([0, 1, 2, 3, 4].map((index) => starFill(3.5, index))).toEqual([100, 100, 100, 50, 0])
  })

  it('keeps displayed ratings within the five-star range', () => {
    expect(clampRating(-1)).toBe(0)
    expect(clampRating(6)).toBe(5)
  })
})
