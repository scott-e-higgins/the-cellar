import { markFormSaved } from './unsaved-changes'

export type NoticeTone = 'success' | 'warning'

export const OVERLAY_Z_INDEX = {
  management: 50,
  action: 60,
  lightbox: 70,
  toast: 80,
} as const

export async function finishSuccessfulAction({
  refresh,
  form,
  finish,
  notice,
  message,
  tone = 'success',
}: {
  form?: HTMLFormElement | null
  refresh: () => Promise<void>
  finish?: () => void
  notice: (message: string, tone?: NoticeTone) => void
  message: string
  tone?: NoticeTone
}) {
  markFormSaved(form)
  try {
    await refresh()
  } catch {
    finish?.()
    markFormSaved(form)
    notice(`Saved, but the screen could not refresh.${tone === 'warning' ? ` ${message}` : ''}`, 'warning')
    return
  }
  finish?.()
  markFormSaved(form)
  notice(message, tone)
}
