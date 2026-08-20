export type NoticeTone = 'success' | 'warning'

export const OVERLAY_Z_INDEX = {
  management: 50,
  action: 60,
  lightbox: 70,
  toast: 80,
} as const

export async function finishSuccessfulAction({
  refresh,
  finish,
  notice,
  message,
  tone = 'success',
}: {
  refresh: () => Promise<void>
  finish?: () => void
  notice: (message: string, tone?: NoticeTone) => void
  message: string
  tone?: NoticeTone
}) {
  await refresh()
  finish?.()
  notice(message, tone)
}
