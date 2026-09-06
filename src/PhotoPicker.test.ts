import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PhotoPicker } from './PhotoPicker'

describe('shared photo picker', () => {
  it('uses the native image chooser without forcing camera capture', () => {
    const markup = renderToStaticMarkup(createElement(PhotoPicker, { label: 'Visit photo' }))

    expect(markup).toContain('accept="image/*"')
    expect(markup).toContain('Take Photo or Choose from Photos')
    expect(markup).not.toContain('capture=')
  })
})
