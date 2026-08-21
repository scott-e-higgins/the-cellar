import { useState } from 'react'

export const clampRating = (value: number) => Math.min(5, Math.max(0, value))

export const starFill = (value: number, index: number) => {
  const remaining = clampRating(value) - index
  return Math.min(100, Math.max(0, remaining * 100))
}

export function StarRatingDisplay({ value, compact = false, showValue = false }: { value: number; compact?: boolean; showValue?: boolean }) {
  const rating = clampRating(value)
  return <span className={`star-rating-display ${compact ? 'compact' : ''}`} aria-label={`${rating.toFixed(1)} out of 5 stars`}>
    <span className="star-rating-glyphs" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((index) => <span className="star-glyph" key={index}>
        <span className="star-empty">☆</span>
        <span className="star-filled" style={{ width: `${starFill(rating, index)}%` }}>★</span>
      </span>)}
    </span>
    {showValue && <span className="star-rating-value">{rating.toFixed(1)}</span>}
  </span>
}

export function StarRatingInput({ name, label = 'Rating', defaultValue = null }: { name: string; label?: string; defaultValue?: number | null }) {
  const [value, setValue] = useState<number | null>(defaultValue === null ? null : clampRating(defaultValue))
  return <fieldset className="star-rating-field">
    <legend>{label}</legend>
    <input type="hidden" name={name} value={value ?? ''} />
    <div className="star-rating-input" role="group" aria-label={label}>
      {[1, 2, 3, 4, 5].map((star) => <button
        key={star}
        type="button"
        className={value !== null && star <= value ? 'selected' : ''}
        onClick={() => setValue(star)}
        aria-label={`${star} star${star === 1 ? '' : 's'}`}
        aria-pressed={value === star}
      >{value !== null && star <= value ? '★' : '☆'}</button>)}
      {value !== null && <button type="button" className="star-rating-clear" onClick={() => setValue(null)}>Clear</button>}
    </div>
  </fieldset>
}
