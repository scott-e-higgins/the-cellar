// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowModal } from './WorkflowModal'
import { EMPTY_CELLAR_DATA, type CellarData } from './lib/cellar-data'
import { installUnsavedNavigationGuard } from './lib/unsaved-changes'

const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), upload: vi.fn(), insert: vi.fn(), upsert: vi.fn() }))
vi.mock('./lib/supabase', () => ({ supabase: { rpc: api.rpc, from: api.from, storage: { from: () => ({ upload: api.upload }) } } }))
const fixture = { ...EMPTY_CELLAR_DATA, wineries: [{ id: 'winery', name: 'Test Winery' }], wines: [{ id: 'wine', name: 'Test Wine', wineryId: 'winery' }], locations: [{ id: 'rack', name: 'Rack', isActive: true }], bottleLots: [{ wineId: 'wine', purchaseItemId: 'lot', storageLocationId: 'rack', storageLocationName: 'Rack', wineLabel: 'Test Wine', quantity: 5, agingQuantity: 0 }] } as CellarData
let saved = vi.fn<() => Promise<void>>(), close = vi.fn<() => void>(), notice = vi.fn<(message: string, tone?: 'success' | 'warning') => void>()
function mount(action: 'open-bottle' | 'add-winery-visit' | 'record-purchase' = 'open-bottle') {
  return render(createElement(WorkflowModal, { action, householdId: 'household', data: fixture, initialWineId: 'wine', initialWineryId: 'winery', onSaved: saved, onClose: close, onNotice: notice }))
}
// Bridge user-event's public FileList shim into jsdom FormData (native browsers
// already read these selected files). All non-file fields use native FormData.
const NativeFormData = window.FormData
class SelectedFileFormData extends NativeFormData {
  constructor(form?: HTMLFormElement) {
    super(form)
    form?.querySelectorAll<HTMLInputElement>('input[type=file]').forEach((input) => {
      if (!input.matches(':disabled') && input.files?.length) this.set(input.name, input.files[0])
    })
  }
}
function fileInput(file: File) {
  const input = document.querySelector('input[type=file]') as HTMLInputElement
  return userEvent.setup({ applyAccept: false }).upload(input, file)
}
async function submit() { fireEvent.submit(document.querySelector('form')!); await waitFor(() => expect(screen.queryByText('Saving…')).toBeNull()) }
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('FormData', SelectedFileFormData)
  installUnsavedNavigationGuard()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  saved = vi.fn().mockResolvedValue(undefined); close = vi.fn(); notice = vi.fn()
  api.rpc.mockResolvedValue({ data: 'opening', error: null })
  api.upload.mockResolvedValue({ error: null })
  api.upsert.mockResolvedValue({ error: null })
  api.insert.mockImplementation(() => ({ select: () => ({ single: async () => ({ data: { id: 'visit' }, error: null }) }) }))
  api.from.mockImplementation(() => ({ insert: api.insert, upsert: api.upsert }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe.each(['open-bottle', 'add-winery-visit'] as const)('%s save and photos', (action) => {
  it('valid photo: saves parent once, uploads and attaches, then refreshes and closes', async () => {
    mount(action); await fileInput(new File(['photo'], 'test.jpg', { type: 'image/jpeg' })); await submit()
    expect(api.rpc).toHaveBeenCalledOnce()
    expect(api.upload).toHaveBeenCalledOnce(); expect(api.upsert).toHaveBeenCalledOnce()
    expect(saved).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce()
    expect(notice).toHaveBeenCalledWith('Saved successfully.', 'success')
  })
  it.each(['oversized', 'invalid'])('%s photo: makes no record or inventory mutation', async (kind) => {
    mount(action)
    const file = kind === 'oversized' ? new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' }) : new File(['text'], 'bad.txt', { type: 'text/plain' })
    await fileInput(file); await submit()
    expect(api.rpc).not.toHaveBeenCalled(); expect(api.insert).not.toHaveBeenCalled(); expect(api.upload).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/too large|Choose a JPEG/)
    expect(close).not.toHaveBeenCalled()
  })
  it.each(['upload', 'metadata'])('retries %s failure only, without duplicating parent or decrement', async (stage) => {
    ;(stage === 'upload' ? api.upload : api.upsert).mockResolvedValueOnce({ error: new Error('offline') })
    mount(action); await fileInput(new File(['photo'], 'test.jpg', { type: 'image/jpeg' })); await submit()
    expect(screen.getByRole('alert').textContent).toContain('Record saved; photo not added.')
    expect(close).not.toHaveBeenCalled()
    // Even an accidental/programmatic form submission cannot repeat the mutation.
    fireEvent.submit(document.querySelector('form')!)
    fireEvent.click(screen.getByRole('button', { name: 'Retry Photo' }))
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(api.rpc).toHaveBeenCalledOnce()
    if (stage === 'metadata') {
      expect(api.upload).toHaveBeenCalledOnce()
      expect(api.upsert.mock.calls[0][0].id).toBe(api.upsert.mock.calls[1][0].id)
    } else expect(api.upload.mock.calls[0][0]).toBe(api.upload.mock.calls[1][0])
  })
  it('successful save plus refresh failure closes with warning and blocks resubmission', async () => {
    saved.mockRejectedValue(new Error('refresh failed'))
    mount(action); await submit()
    expect(close).toHaveBeenCalledOnce()
    expect(notice).toHaveBeenCalledWith('Saved, but the screen could not refresh.', 'warning')
    fireEvent.submit(document.querySelector('form')!)
    expect(api.rpc).toHaveBeenCalledOnce()
  })
})

it('separates opening/gifting dates and recipients and preserves both drafts', async () => {
  mount()
  fireEvent.change(screen.getByLabelText('Opening date'), { target: { value: '2026-08-01' } })
  fireEvent.click(screen.getByLabelText('Gifted', { exact: true }))
  expect((screen.getByLabelText('Gifted to') as HTMLInputElement).value).toBe('')
  expect((screen.getByLabelText('Date', { exact: true }) as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  fireEvent.change(screen.getByLabelText('Gifted to'), { target: { value: 'Friend' } })
  fireEvent.click(screen.getByLabelText('Opened', { exact: true }))
  expect((screen.getByLabelText('Opening date') as HTMLInputElement).value).toBe('2026-08-01')
  fireEvent.click(screen.getByLabelText('Gifted', { exact: true }))
  expect((screen.getByLabelText('Gifted to') as HTMLInputElement).value).toBe('Friend')
  await submit()
  expect(api.rpc).toHaveBeenCalledWith('gift_bottle_v2', expect.objectContaining({ p_gifted_to: 'Friend' }))
})

it('keeps Purchased at out of Gift from, retaining independent acquisition drafts', () => {
  mount('record-purchase')
  fireEvent.change(screen.getByLabelText('Purchased at'), { target: { value: 'Shop' } })
  fireEvent.change(screen.getByLabelText('Acquisition'), { target: { value: 'gift' } })
  expect((screen.getByLabelText('Gift from') as HTMLInputElement).value).toBe('')
  fireEvent.change(screen.getByLabelText('Acquisition'), { target: { value: 'purchased' } })
  expect((screen.getByLabelText('Purchased at') as HTMLInputElement).value).toBe('Shop')
})

it('rejects two immediate submissions while the first save is pending', async () => {
  let resolve!: (value: unknown) => void
  api.rpc.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  mount(); fireEvent.submit(document.querySelector('form')!); fireEvent.submit(document.querySelector('form')!)
  expect(api.rpc).toHaveBeenCalledOnce()
  resolve({ data: 'opening', error: null })
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
})


it.each(['open-bottle', 'add-winery-visit'] as const)('%s lost save acknowledgement cannot be blindly resubmitted', async(action) => {
  api.rpc.mockRejectedValueOnce(new Error('Connection lost after commit'))
  mount(action); await submit()
  expect(screen.getByRole('alert').textContent).toContain('Save could not be confirmed')
  fireEvent.submit(document.querySelector('form')!)
  expect(api.rpc).toHaveBeenCalledOnce()
  saved.mockRejectedValueOnce(new Error('Refresh offline'))
  fireEvent.click(screen.getByRole('button',{name:'Refresh & Check'}));await screen.findByText(/The screen could not refresh/)
  expect(close).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'Refresh & Check'}));await waitFor(()=>expect(close).toHaveBeenCalledOnce())
  expect(api.rpc).toHaveBeenCalledOnce()
  expect(notice).toHaveBeenCalledWith(expect.stringContaining('before recording this again'),'warning')
})
