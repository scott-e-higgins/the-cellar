import { useRef, useState, type FormEvent } from 'react'
import type { CellarData } from './lib/cellar-data'
import { bottleMoveGroups } from './lib/bottle-moves'
import { supabase } from './lib/supabase'
import { createUniqueId } from './lib/unique-id'
import { finishSuccessfulAction, type NoticeTone } from './lib/interaction'
import { userError } from './lib/user-error'
import { ModalLayer } from './OverlayLayer'

type MoveRequest = { p_household_id: string; p_request_id: string; p_bottle_ids: string[]; p_from_location_id: string; p_to_location_id: string }

export function MoveBottleModal({ wineId, householdId, data, onClose, onSaved, onNotice }: {
  wineId: string; householdId: string; data: CellarData; onClose: () => void; onSaved: () => Promise<void>; onNotice: (message: string, tone?: NoticeTone) => void
}) {
  const groups = bottleMoveGroups(data, wineId)
  const [choice, setChoice] = useState(groups[0]?.key ?? '')
  const group = groups.find(group => group.key === choice)
  const [quantity, setQuantity] = useState(1)
  const [destination, setDestination] = useState('')
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [message, setMessage] = useState('')
  const saved = useRef(false), saving = useRef(false)
  const request = useRef<MoveRequest | null>(null)
  const destinations = data.locations.filter(location => location.isActive && location.id !== group?.locationId)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || saved.current || saving.current) return
    const form = event.currentTarget
    setMessage('')
    if (!request.current) {
      if (!group || !Number.isInteger(quantity) || quantity < 1 || quantity > group.bottles.length || !destinations.some(location => location.id === destination)) {
        setMessage('Choose the bottles and a different storage location.'); return
      }
      request.current = { p_household_id: householdId, p_request_id: createUniqueId(), p_bottle_ids: group.bottles.slice(0, quantity).map(bottle => bottle.id), p_from_location_id: group.locationId, p_to_location_id: destination }
    }
    saving.current = true; setBusy(true)
    try {
      const result = await supabase.rpc('move_physical_bottles', request.current)
      if (result.error) {
        // A PostgreSQL error is a confirmed rollback. A transport failure may
        // have committed, so retain the exact request for an idempotent retry.
        if (/^[0-9A-Z]{5}$/.test(result.error.code ?? '')) request.current = null
        throw new Error(result.error.message)
      }
      saved.current = true
      await finishSuccessfulAction({ form, refresh: onSaved, finish: onClose, notice: onNotice, message: 'Location updated.' })
    } catch (error) {
      setUncertain(Boolean(request.current))
      setMessage(request.current ? 'The move could not be confirmed. Retry safely to check and finish this same move.' : userError(error, 'The bottles could not be moved. Please try again.'))
    } finally { saving.current = false; setBusy(false) }
  }
  return <ModalLayer layer="action" onDismiss={onClose} dismissible={!busy} surfaceClassName="workflow-modal workflow-form-modal" ariaLabel="Change Location">
    <div className="sheet-header detail-header"><button className="icon-close" onClick={onClose} disabled={busy} aria-label="Back">‹</button><div><p className="eyebrow burgundy">{data.wines.find(wine => wine.id === wineId)?.name}</p><h2>Change Location</h2></div><span className="header-spacer" /></div>
    <form className="workflow-form" aria-busy={busy} onSubmit={submit}>
      <fieldset className="workflow-fields" disabled={busy || uncertain || saved.current}>
        {groups.length > 1 ? <label>Which bottles?<select name="bottles" value={choice} onChange={event => { setChoice(event.target.value); setQuantity(1); setDestination('') }}>{groups.map(group => <option key={group.key} value={group.key}>{group.label} · {group.bottles.length} available</option>)}</select></label> : group ? <p><strong>Current location</strong><br />{group.label}</p> : <p>No available bottles. Refresh the collection to check current inventory.</p>}
        {group && <>{group.bottles.length > 1 && <label>How many bottles?<input name="quantity" type="number" inputMode="numeric" min="1" max={group.bottles.length} step="1" value={quantity} onChange={event => setQuantity(Number(event.target.value))} /></label>}{group.aging && <p>Aging and your Hold decision stay with these bottles.</p>}<label>Move to<select name="destination" required value={destination} onChange={event => setDestination(event.target.value)}><option value="">Choose destination</option>{destinations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>{!destinations.length && <p>Add another location in More → Storage, then return here.</p>}</>}
      </fieldset>
      {message && <p className="form-message error" role="alert">{message}</p>}
      <div className="form-actions"><button type="button" data-discard className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary-button" disabled={busy || saved.current || (!uncertain && (!group || !destinations.length))}>{busy ? 'Moving…' : uncertain ? 'Retry Move' : 'Save'}</button></div>
    </form>
  </ModalLayer>
}
