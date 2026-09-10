// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CellarShell } from './App'
import { EMPTY_CELLAR_DATA, type CellarData } from './lib/cellar-data'
import { installUnsavedNavigationGuard, pushCellarHistory } from './lib/unsaved-changes'

const api = vi.hoisted(() => ({ load: vi.fn(), update: vi.fn(), insert: vi.fn(), rpc: vi.fn() }))
vi.mock('./lib/cellar-data', async (original) => ({ ...await original<typeof import('./lib/cellar-data')>(), loadCellarData: api.load }))
vi.mock('./lib/supabase', () => ({ supabase: { rpc: api.rpc, from: () => ({ update: api.update, insert: api.insert }) }, isSupabaseConfigured: true }))
const winery = { id: 'winery', name: 'Test Winery', country: 'US', wineCount: 0, visitCount: 0, favorite: false }
const data = { ...EMPTY_CELLAR_DATA, wineries: [winery] } as CellarData
beforeEach(() => {
  vi.clearAllMocks()
  installUnsavedNavigationGuard()
  pushCellarHistory({ cellarOverlay: null }, '#/wineries')
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  HTMLElement.prototype.scrollTo = vi.fn(function(this: HTMLElement, options?: ScrollToOptions | number, y?: number) { this.scrollTop = typeof options === 'number' ? y ?? 0 : options?.top ?? 0 })
  api.rpc.mockResolvedValue({data:"visit",error:null})
  api.load.mockResolvedValue(data)
  api.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: 'visit' }, error: null }) }) })
  api.update.mockImplementation(() => ({ eq: () => ({ eq: async () => ({ error: null }) }) }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
async function mount() {
  render(createElement(CellarShell, { household: { householdId: 'household', role: 'owner', displayName: 'Tester' }, onSignOut: vi.fn() }))
  await waitFor(() => expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(false))
}
async function edit() {
  await mount()
  fireEvent.click(screen.getAllByRole('button', { name: 'Open Test Winery' })[0])
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  // Allow the shared observer to capture the newly mounted form's baseline.
  await act(async () => {})
}
it('collection load failure retries successfully in the same section', async () => {
  api.load.mockRejectedValueOnce(new Error('offline'))
  await mount()
  expect(screen.getByRole('alert').textContent).toContain('connection')
  fireEvent.click(screen.getByRole('button', { name: 'Retry Refresh' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Wineries')
  expect(api.load).toHaveBeenCalledTimes(2)
})

it('refresh failure/recovery preserves search and existing results', async () => {
  await mount()
  const search = screen.getByPlaceholderText('Search wineries or locations...') as HTMLInputElement
  fireEvent.change(search, { target: { value: 'Test' } })
  api.load.mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await screen.findByRole('alert')
  expect(search.value).toBe('Test')
  expect(screen.getAllByRole('button', { name: 'Open Test Winery' }).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: 'Retry Refresh' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(search.value).toBe('Test')
})

it.each(['Cancel', 'History', 'Back'])('modified Edit → %s asks before discarding; declining retains values', async (action) => {
  await edit()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved winery' } })
  fireEvent.click(screen.getAllByRole('button', { name: action })[0])
  expect(window.confirm).toHaveBeenCalledOnce()
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Unsaved winery')
})

it('unchanged Edit cancels immediately; editing and reverting also needs no warning', async () => {
  await edit()
  const name = screen.getByLabelText('Name')
  fireEvent.change(name, { target: { value: 'Changed' } })
  fireEvent.change(name, { target: { value: 'Test Winery' } })
  fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0])
  expect(window.confirm).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('Name')).toBeNull()
})

it('browser Back cancellation retains the edit and history entry; accepting then returns correctly', async () => {
  await edit()
  const index = window.history.state.cellarHistoryIndex
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved winery' } })
  act(() => window.history.back())
  await waitFor(() => expect(window.confirm).toHaveBeenCalledOnce())
  await waitFor(() => expect(window.history.state.cellarHistoryIndex).toBe(index))
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Unsaved winery')
  vi.mocked(window.confirm).mockReturnValue(true)
  act(() => window.history.back())
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(window.history.state.cellarHistoryIndex).toBe(index - 1)
})

it('saved Edit plus refresh failure exits edit, preserves save, and Retry Refresh performs no mutation', async () => {
  await edit()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Saved winery' } })
  api.load.mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(screen.getByRole('button', { name: 'Save winery' }))
  await waitFor(() => expect(screen.queryByLabelText('Name')).toBeNull())
  expect(api.update).toHaveBeenCalledOnce()
  const toast = screen.getByRole('status')
  expect(toast.textContent).toContain('Saved, but the screen could not refresh.')
  fireEvent.click(within(toast).getByRole('button', { name: 'Retry Refresh' }))
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  expect(api.update).toHaveBeenCalledOnce()
  expect(window.confirm).not.toHaveBeenCalled()
})

it('contextual Add Visit cancellation restores winery scroll and search', async () => {
  await mount()
  const search = screen.getByPlaceholderText('Search wineries or locations...') as HTMLInputElement
  fireEvent.change(search, { target: { value: 'Test' } })
  fireEvent.click(screen.getAllByRole('button', { name: 'Open Test Winery' })[0])
  const detail = screen.getByRole('dialog')
  await act(async () => { await new Promise(requestAnimationFrame) })
  fireEvent.scroll(detail, { target: { scrollTop: 750 } })
  fireEvent.click(screen.getByRole('button', { name: 'Add Visit' }))
  expect((screen.getByLabelText('Winery') as HTMLInputElement).value).toBe('Test Winery')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Add Winery Visit' })).toBeNull())
  expect(detail.scrollTop).toBe(750)
  expect(search.value).toBe('Test')
  expect(window.confirm).not.toHaveBeenCalled()
})

it('clicking the already selected Details tab does not discard or clear the edit guard', async () => {
  await edit()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved winery' } })
  fireEvent.click(screen.getByRole('button', { name: 'Details' }))
  expect(window.confirm).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(window.confirm).toHaveBeenCalledOnce()
})

it.each(['escape', 'backdrop', 'section', 'cancel-in-form'])('%s protects dirty edits', async (action) => {
  await edit()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved winery' } })
  if (action === 'escape') fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  if (action === 'backdrop') fireEvent.mouseDown(document.querySelector('.modal-backdrop')!)
  if (action === 'section') fireEvent.click(screen.getByRole('button', { name: 'Cellar' }))
  if (action === 'cancel-in-form') fireEvent.click(within(document.querySelector('form')!).getByRole('button', { name: 'Cancel' }))
  expect(window.confirm).toHaveBeenCalledOnce()
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Unsaved winery')
})

it('a completed background action cannot mark an unrelated draft as saved', async () => {
  await edit()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved winery' } })
  const { finishSuccessfulAction } = await import('./lib/interaction')
  await finishSuccessfulAction({ refresh: async () => {}, notice: () => {}, message: 'Background update completed.' })
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(window.confirm).toHaveBeenCalledOnce()
})


it('successful Add Visit returns exactly one level without a discard warning', async () => {
  await mount()
  fireEvent.click(screen.getAllByRole('button', { name: 'Open Test Winery' })[0])
  fireEvent.click(screen.getByRole('button', { name: 'Add Visit' }))
  const index = window.history.state.cellarHistoryIndex
  fireEvent.change(screen.getByLabelText('Visit memories'), { target: { value: 'A test memory' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Add Winery Visit' })).toBeNull())
  expect(screen.getByRole('dialog').textContent).toContain('Test Winery')
  expect(window.history.state.cellarHistoryIndex).toBe(index - 1)
  expect(api.rpc).toHaveBeenCalledWith('save_winery_visit',expect.any(Object))
  expect(window.confirm).not.toHaveBeenCalled()
})
