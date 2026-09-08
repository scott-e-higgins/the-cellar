import { useLayoutEffect, useRef, type RefObject } from 'react'

type Guard = { dirty: () => boolean; busy: () => boolean; accept: (form?: HTMLFormElement) => void; priority: number }
const guards = new Set<Guard>()
const activeGuard = () => [...guards].sort((a, b) => b.priority - a.priority)[0]

// Include disabled conditional fields: changing mode must not erase a draft.
export function formSnapshot(form: HTMLFormElement) {
  return JSON.stringify(Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')).map((field) => [
    field.name,
    field instanceof HTMLInputElement && field.type === 'file'
      ? Array.from(field.files ?? []).map((file) => [file.name, file.size, file.lastModified])
      : field instanceof HTMLInputElement && ['checkbox', 'radio'].includes(field.type) ? field.checked : field.value,
  ]))
}

export function markFormSaved(form?: HTMLFormElement | null) {
  if (form) guards.forEach((guard) => guard.accept(form))
}

export function confirmAbandon() {
  const guard = activeGuard()
  if (guard?.busy()) return false
  if (!guard?.dirty()) return true
  if (!window.confirm('Discard your unsaved changes?')) return false
  guard.accept()
  return true
}

export function useFormGuard(surface: RefObject<HTMLElement | null>, priority: number, busy: boolean) {
  const busyRef = useRef(busy)
  busyRef.current = busy
  useLayoutEffect(() => {
    const baselines = new Map<HTMLFormElement, string>()
    const collect = () => {
      for (const form of baselines.keys()) if (!surface.current?.contains(form)) baselines.delete(form)
      surface.current?.querySelectorAll<HTMLFormElement>('form').forEach((form) => {
        if (!baselines.has(form)) baselines.set(form, formSnapshot(form))
      })
    }
    collect()
    const observer = new MutationObserver(collect)
    if (surface.current) observer.observe(surface.current, { childList: true, subtree: true })
    const guard: Guard = {
      priority,
      busy: () => busyRef.current || Boolean(surface.current?.querySelector('form[aria-busy="true"]')),
      dirty: () => { collect(); return [...baselines].some(([form, baseline]) => formSnapshot(form) !== baseline) },
      accept: (target) => {
        collect()
        if (target && !baselines.has(target)) return
        baselines.forEach((_, form) => { if (!target || form === target) baselines.set(form, formSnapshot(form)) })
      },
    }
    guards.add(guard)
    return () => { observer.disconnect(); guards.delete(guard) }
  }, [surface, priority])
}

let installed = false
let current = { index: 0, url: '', state: {} as Record<string, unknown> }
export function pushCellarHistory(state: Record<string, unknown>, url = window.location.href) {
  const next = { ...state, cellarHistoryIndex: current.index + 1 }
  window.history.pushState(next, '', url)
  current = { index: next.cellarHistoryIndex, url: window.location.href, state: next }
}

// Register before React listeners, so cancelled Back never unmounts the form.
export function installUnsavedNavigationGuard() {
  if (installed) return
  installed = true
  current = { index: Number(window.history.state?.cellarHistoryIndex ?? 0), url: window.location.href, state: window.history.state ?? {} }
  window.history.replaceState({ ...current.state, cellarHistoryIndex: current.index }, '')
  let restoring = false
  window.addEventListener('popstate', (event) => {
    if (restoring) { restoring = false; event.stopImmediatePropagation(); return }
    const nextIndex = Number(event.state?.cellarHistoryIndex ?? 0)
    if (nextIndex !== current.index && !confirmAbandon()) {
      event.stopImmediatePropagation()
      restoring = true
      window.history.go(current.index - nextIndex)
      return
    }
    current = { index: nextIndex, url: window.location.href, state: event.state ?? {} }
  }, true)
  window.addEventListener('beforeunload', (event) => {
    if ([...guards].some((guard) => guard.dirty() || guard.busy())) { event.preventDefault(); event.returnValue = '' }
  })
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button, a') : null
    if (!target || target.closest('[data-keep-draft]') || target.matches('.detail-tabs button.active, a[target="_blank"]')) return
    // Form buttons edit/save by default; explicit Cancel buttons abandon.
    if (target.closest('form') && !target.hasAttribute('data-discard')) return
    if (!confirmAbandon()) { event.preventDefault(); event.stopImmediatePropagation() }
  }, true)
}
