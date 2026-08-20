import { describe, expect, it, vi } from 'vitest'
import { finishSuccessfulAction, OVERLAY_Z_INDEX } from './interaction'

describe('shared interaction behavior', () => {
  it('keeps actions above records, lightboxes above actions, and feedback above all overlays', () => {
    expect(OVERLAY_Z_INDEX.management).toBeLessThan(OVERLAY_Z_INDEX.action)
    expect(OVERLAY_Z_INDEX.action).toBeLessThan(OVERLAY_Z_INDEX.lightbox)
    expect(OVERLAY_Z_INDEX.lightbox).toBeLessThan(OVERLAY_Z_INDEX.toast)
  })

  it('refreshes before completing the workflow and showing feedback', async () => {
    const calls: string[] = []
    await finishSuccessfulAction({
      refresh: vi.fn(async () => { calls.push('refresh') }),
      finish: vi.fn(() => { calls.push('finish') }),
      notice: vi.fn(() => { calls.push('notice') }),
      message: 'Saved.',
    })
    expect(calls).toEqual(['refresh', 'finish', 'notice'])
  })

  it('does not close or report success when refresh fails', async () => {
    const finish = vi.fn()
    const notice = vi.fn()
    await expect(finishSuccessfulAction({
      refresh: vi.fn(async () => { throw new Error('refresh failed') }),
      finish,
      notice,
      message: 'Saved.',
    })).rejects.toThrow('refresh failed')
    expect(finish).not.toHaveBeenCalled()
    expect(notice).not.toHaveBeenCalled()
  })
})
