import { KeyboardEvent, ReactNode, Ref, RefObject, UIEventHandler, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { OVERLAY_Z_INDEX } from './lib/interaction'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function useModalFocus(onDismiss: () => void, dismissible: boolean, surfaceRef?: RefObject<HTMLElement | null>) {
  const internalRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const surface = surfaceRef?.current ?? internalRef.current
    const first = surface?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? surface)?.focus({ preventScroll: true })
    return () => previousFocus?.focus({ preventScroll: true })
  }, [])

  const assignRef = (node: HTMLElement | null) => {
    internalRef.current = node
    if (surfaceRef) surfaceRef.current = node
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && dismissible) {
      event.preventDefault()
      onDismiss()
      return
    }
    if (event.key !== 'Tab') return
    const surface = surfaceRef?.current ?? internalRef.current
    const focusable = Array.from(surface?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    if (!focusable.length) {
      event.preventDefault()
      surface?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable.at(-1)!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return { assignRef, onKeyDown }
}

export function ModalLayer({
  layer,
  onDismiss,
  dismissible = true,
  surfaceClassName,
  surfaceRef,
  ariaLabel,
  ariaLabelledBy,
  onSurfaceScroll,
  children,
}: {
  layer: 'management' | 'action'
  onDismiss: () => void
  dismissible?: boolean
  surfaceClassName: string
  surfaceRef?: RefObject<HTMLElement | null>
  ariaLabel?: string
  ariaLabelledBy?: string
  onSurfaceScroll?: UIEventHandler<HTMLElement>
  children: ReactNode
}) {
  const modal = useModalFocus(onDismiss, dismissible, surfaceRef)
  return createPortal(
    <div
      className={`modal-backdrop modal-layer-${layer}`}
      style={{ zIndex: OVERLAY_Z_INDEX[layer] }}
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && dismissible && onDismiss()}
    >
      <section
        ref={modal.assignRef}
        className={surfaceClassName}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        tabIndex={-1}
        onKeyDown={modal.onKeyDown}
        onScroll={onSurfaceScroll}
      >
        {children}
      </section>
    </div>,
    document.body,
  )
}

export function LightboxLayer({ ariaLabel, onDismiss, children }: { ariaLabel: string; onDismiss: () => void; children: ReactNode }) {
  const modal = useModalFocus(onDismiss, true)
  return createPortal(
    <div
      ref={modal.assignRef as Ref<HTMLDivElement>}
      className="photo-viewer"
      style={{ zIndex: OVERLAY_Z_INDEX.lightbox }}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      tabIndex={-1}
      onKeyDown={modal.onKeyDown}
      onMouseDown={(event) => event.target === event.currentTarget && onDismiss()}
    >
      {children}
    </div>,
    document.body,
  )
}
