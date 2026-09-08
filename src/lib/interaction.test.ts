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

  it('finishes a successful mutation even if refresh fails, and reports the distinction', async () => {
    const finish = vi.fn(), notice = vi.fn()
    await finishSuccessfulAction({ refresh: vi.fn().mockRejectedValue(new Error('offline')), finish, notice, message: 'Saved.' })
    expect(finish).toHaveBeenCalledOnce()
    expect(notice).toHaveBeenCalledWith('Saved, but the screen could not refresh.', 'warning')
  })

  it('preserves attachment warnings when refresh also fails', async () => {
    const notice = vi.fn()
    await finishSuccessfulAction({ refresh: vi.fn().mockRejectedValue(new Error('offline')), notice, message: 'Record saved; photo not added.', tone: 'warning' })
    expect(notice).toHaveBeenCalledWith('Saved, but the screen could not refresh. Record saved; photo not added.', 'warning')
  })
})
