import { useRef, useState, type FormEvent } from 'react'
import type { CellarData } from './lib/cellar-data'
import { supabase } from './lib/supabase'
import { createUniqueId } from './lib/unique-id'
import { finishSuccessfulAction, type NoticeTone } from './lib/interaction'
import { userError } from './lib/user-error'
import { ModalLayer } from './OverlayLayer'
import { US_STATES } from './StateSelect'

export type WineDraft = Record<string, string> & { name: string; winery_id: string; vintage: string; non_vintage: string }
export type AcquisitionLine = { id: string; wineId: string; draft: WineDraft | null; quantity: string; location: string; price: string; currentValue: string }
const today = () => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
const blankWine = (winery: string): WineDraft => ({ name: '', winery_id: winery, vintage: '', non_vintage: 'false', closure: 'Cork' })
const numeric = (value: string | undefined) => value?.trim() ? Number(value) : null
export function acquisitionItems(lines: AcquisitionLine[], gift: boolean) {
  return lines.map((line) => {
    const quantity = Number(line.quantity), price = gift ? null : numeric(line.price)
    if ([price, numeric(line.currentValue)].some((value) => value !== null && (!Number.isFinite(value) || value < 0))) throw new Error('Enter a valid non-negative bottle price or value.')
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Enter a whole number of bottles for each wine.')
    if (!line.location) throw new Error('Choose where to put each wine.')
    if (!line.wineId && !line.draft?.name.trim()) throw new Error('Choose or name each wine.')
    return { wine_id: line.wineId || null, new_wine: line.draft ? { ...line.draft, name: line.draft.name.trim(), non_vintage: line.draft.non_vintage === 'true', vintage: line.draft.non_vintage === 'true' ? null : numeric(line.draft.vintage) } : undefined, quantity, storage_location_id: line.location, unit_price: price, total_cost: price === null ? null : Math.round(price * quantity * 100) / 100, current_value_per_bottle: gift ? null : numeric(line.currentValue) ?? price }
  })
}

export function AcquisitionModal({ action, householdId, data, initialWineryId, initialVisitId, initialDate, initialTripId, onClose, onSaved, onNotice }: {
  action: 'add-wine' | 'record-purchase'; householdId: string; data: CellarData; initialWineryId?: string | null; initialVisitId?: string | null; initialDate?: string | null; initialTripId?: string | null;
  onClose: () => void; onSaved: () => Promise<void>; onNotice: (message: string, tone?: NoticeTone) => void
}) {
  const newWine = action === 'add-wine'
  const [step, setStep] = useState(newWine ? 1 : 2)
  const [definitionOnly, setDefinitionOnly] = useState(false)
  const [winery, setWinery] = useState(initialWineryId ?? '')
  const rack = data.locations.find((item) => item.isActive && item.name.toLowerCase() === 'rack') ?? data.locations.find((item) => item.isActive)
  const line = (draft = false): AcquisitionLine => ({ id: createUniqueId(), wineId: '', draft: draft ? blankWine(winery) : null, quantity: '1', location: rack?.id ?? '', price: '', currentValue: '' })
  const [lines, setLines] = useState<AcquisitionLine[]>(() => [line(newWine)])
  const [kind, setKind] = useState('purchased')
  const [date, setDate] = useState(initialDate ?? today())
  const [trip, setTrip] = useState(initialTripId ?? '')
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [uncertain, setUncertain] = useState(false)
  const requestId = useRef(createUniqueId()), inFlight = useRef(false), saved = useRef(false)
  const payload = useRef<Record<string, unknown> | null>(null)
  const update = (id: string, patch: Partial<AcquisitionLine>) => setLines((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  const selectedWinery = data.wineries.find((item) => item.id === winery)
  const title = newWine ? 'Add Wine' : 'Add Bottles'
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || inFlight.current || saved.current) return
    const formElement = event.currentTarget
    if (step === 1 && !definitionOnly) { setStep(2); return }
    inFlight.current = true; setBusy(true); setMessage('')
    try {
      if (!uncertain || !payload.current) {
        const form = new FormData(formElement), gift = kind === 'gift'
        const items = definitionOnly ? [{ new_wine: { ...lines[0].draft, non_vintage: lines[0].draft?.non_vintage === 'true', vintage: lines[0].draft?.non_vintage === 'true' ? null : numeric(lines[0].draft?.vintage) } }] : acquisitionItems(lines, gift)
        const valued = items as ReturnType<typeof acquisitionItems>
        const subtotal = definitionOnly || gift || valued.some((item) => item.total_cost === null) ? null : valued.reduce((sum, item) => sum + (item.total_cost ?? 0), 0)
        const tax = gift ? null : numeric(String(form.get('tax') ?? '')), discount = gift ? null : numeric(String(form.get('discount') ?? ''))
        payload.current = { p_household_id: householdId, p_request_id: requestId.current, p_definition_only: definitionOnly, p_lines: items, p_details: { acquisition_type: kind, acquisition_date: date, purchase_location: gift ? null : String(form.get('purchase_location') ?? ''), gift_from: gift ? String(form.get('gift_from') ?? '') : null, visit_id: initialVisitId, trip_id: trip || null, notes: String(form.get('notes') ?? ''), selected_by_person_id: gift ? null : form.get('selected_by_person_id'), purchased_by_person_id: gift ? null : form.get('purchased_by_person_id'), subtotal, tax, discount, total_cost: gift ? null : numeric(String(form.get('total_cost') ?? '')) ?? (subtotal === null ? null : subtotal + (tax ?? 0) - (discount ?? 0)) } }
      }
      const result = await supabase.rpc('save_acquisition', payload.current!)
      if (result.error) {
        const unknown = !result.error.code || /fetch|network|timeout|connection/i.test(result.error.message)
        setUncertain(unknown)
        throw result.error
      }
      saved.current = true
      await finishSuccessfulAction({ form: formElement, refresh: onSaved, finish: onClose, notice: onNotice, message: definitionOnly ? 'Wine saved without bottles.' : 'Wines and bottles saved successfully.' })
    } catch (error) { setMessage(userError(error, 'The save could not be confirmed. Retry Save safely retries the same purchase.')) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <ModalLayer layer="action" onDismiss={onClose} dismissible={!busy} surfaceClassName="workflow-modal workflow-form-modal" ariaLabelledBy="acquisition-title">
    <div className="sheet-header"><div><p className="eyebrow burgundy">OUR COLLECTION</p><h2 id="acquisition-title">{title}</h2></div><button className="icon-close" onClick={onClose} disabled={busy} aria-label="Close">×</button></div>
    <form className="workflow-form acquisition-form" onSubmit={submit}>
      <fieldset className="workflow-fields" disabled={busy || uncertain || saved.current}>
        {newWine && <div hidden={step !== 1}><WineEditor value={lines[0].draft!} onChange={(draft) => update(lines[0].id, { draft })} data={data} prefix={lines[0].id} required={step === 1} /><label className="check-field"><input name="definition_only" type="checkbox" checked={definitionOnly} onChange={(event) => setDefinitionOnly(event.target.checked)} /> Save wine without adding bottles</label></div>}
        <div hidden={step !== 2} className="acquisition-body">
          {initialVisitId && <div className="workflow-context"><strong>Purchase from this winery visit</strong><small>{selectedWinery?.name} · {initialDate}{initialTripId ? ' · Trip linked' : ''}</small></div>}
          {!newWine && <label>Winery<select name="purchase_winery" value={winery} onChange={(event) => setWinery(event.target.value)} disabled={Boolean(initialVisitId)}><option value="">Any winery</option>{data.wineries.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
          <div className="acquisition-lines">{lines.map((item, index) => <section className="acquisition-line" key={item.id}>
            <div className="section-action-heading"><h3>{item.draft?.name || `Wine ${index + 1}`}</h3>{lines.length > 1 && <button type="button" className="text-button" onClick={() => { if (window.confirm('Remove this wine from the purchase?')) setLines(lines.filter((row) => row.id !== item.id)) }}>Remove</button>}</div>
            {newWine && index === 0 ? <button type="button" className="text-button" onClick={() => setStep(1)}>Edit wine information</button> : <>
              {!item.draft ? <><label>Wine<select name={`wine_${item.id}`} value={item.wineId} required={step === 2} onChange={(event) => update(item.id, { wineId: event.target.value })}><option value="">Choose a wine</option>{[...data.wines].sort((a,b) => Number(b.wineryId === winery) - Number(a.wineryId === winery)).map((wine) => <option key={wine.id} value={wine.id}>{wine.wineryName ? `${wine.wineryName} · ` : ''}{wine.name} · {wine.nonVintage ? 'NV' : wine.vintage ?? 'Vintage unknown'}</option>)}</select></label><button className="text-button" type="button" onClick={() => update(item.id, { wineId: '', draft: blankWine(winery) })}>Create a missing wine</button></> : <><WineEditor value={item.draft} onChange={(draft) => update(item.id, { draft })} data={data} prefix={item.id} required={step === 2} /><button type="button" className="text-button" onClick={() => { if (!item.draft?.name || window.confirm('Discard the new wine information and choose an existing wine?')) update(item.id, { draft: null }) }}>Choose an existing wine instead</button></>}
            </>}
            <div className="field-grid"><label>Quantity<input name={`quantity_${item.id}`} type="number" min="1" step="1" required={step === 2} value={item.quantity} onChange={(event) => update(item.id, { quantity: event.target.value })} /></label><label>Put bottles in<select name={`location_${item.id}`} required={step === 2} value={item.location} onChange={(event) => update(item.id, { location: event.target.value })}><option value="">Choose location</option>{data.locations.filter((location) => location.isActive).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label></div>
            <div hidden={kind === 'gift'}><label>Price per bottle (optional)<input name={`price_${item.id}`} type="number" min="0" step="0.01" value={item.price} onChange={(event) => update(item.id, { price: event.target.value })} /></label><details className="more-details"><summary>Bottle value</summary><label>Current value per bottle<input name={`value_${item.id}`} type="number" min="0" step="0.01" value={item.currentValue} onChange={(event) => update(item.id, { currentValue: event.target.value })} /></label></details></div>
          </section>)}</div>
          {!newWine && <button type="button" className="secondary-button" onClick={() => setLines([...lines, line()])}>Add another wine</button>}
          <div className="field-grid"><label>Acquisition<select name="acquisition_type" value={kind} onChange={(event) => setKind(event.target.value)}><option value="purchased">Purchased</option><option value="gift">Received as a gift</option></select></label><label>{kind === 'gift' ? 'Date received' : 'Purchase date'}<input name="acquisition_date" type="date" value={date} required={step === 2 && kind === 'purchased'} onChange={(event) => setDate(event.target.value)} /></label></div>
          <fieldset className="workflow-fields" hidden={kind === 'gift'} disabled={kind === 'gift'}><label>Purchased at<input name="purchase_location" key={winery} defaultValue={selectedWinery?.name ?? (newWine ? data.wineries.find((w) => w.id === lines[0].draft?.winery_id)?.name : '')} /></label></fieldset>
          <fieldset className="workflow-fields" hidden={kind !== 'gift'} disabled={kind !== 'gift'}><label>Gift from<input name="gift_from" /></label></fieldset>
          <details className="more-details"><summary>More purchase details</summary><div className="details-fields"><label>Linked Trip<select name="trip_id" disabled={Boolean(initialTripId)} value={trip} onChange={(event) => setTrip(event.target.value)}><option value="">No linked trip</option>{data.trips.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><fieldset className="workflow-fields" disabled={kind === 'gift'} hidden={kind === 'gift'}><div className="field-grid">{[['tax','Tax'],['discount','Discount'],['total_cost','Final total']].map(([name,label]) => <label key={name}>{label}<input name={name} type="number" min="0" step="0.01" /></label>)}</div>{[['purchased_by_person_id','Purchased by'],['selected_by_person_id','Selected by']].map(([name,label]) => <label key={name}>{label}<select name={name}><option value="">Not specified</option>{data.people.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>)}</fieldset><label>Notes<textarea name="notes" rows={3} /></label></div></details>
        </div>
      </fieldset>
      {message && <p className="form-message error" role="alert">{message}</p>}
      {uncertain && <p className="form-message">The connection was interrupted. Retry Save checks the same purchase; it will not add the bottles twice.</p>}
      <div className="form-actions"><button type="button" data-discard className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || saved.current}>{busy ? 'Saving…' : uncertain ? 'Retry Save' : step === 1 && !definitionOnly ? 'Continue to bottles' : 'Save'}</button></div>
    </form>
  </ModalLayer>
}

function WineEditor({ value, onChange, data, prefix, required }: { value: WineDraft; onChange: (value: WineDraft) => void; data: CellarData; prefix: string; required: boolean }) {
  const field = (name: string, label: string, type = 'text') => <label key={name}>{label}<input name={`${prefix}_${name}`} type={type} value={value[name] ?? ''} onChange={(event) => onChange({ ...value, [name]: event.target.value })} /></label>
  const matches = data.wines.filter((wine) => value.name.trim() && wine.name.toLowerCase() === value.name.trim().toLowerCase() && (wine.wineryId ?? '') === value.winery_id && (wine.vintage?.toString() ?? '') === (value.non_vintage === 'true' ? '' : value.vintage) && wine.nonVintage === (value.non_vintage === 'true'))
  return <div className="new-wine-fields"><label>Wine name<input name={`${prefix}_name`} required={required} value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} /></label><label>Winery<select name={`${prefix}_winery_id`} value={value.winery_id} onChange={(event) => onChange({ ...value, winery_id: event.target.value })}><option value="">Not specified</option>{data.wineries.map((winery) => <option value={winery.id} key={winery.id}>{winery.name}</option>)}</select></label><div className="field-grid"><label>Vintage<input name={`${prefix}_vintage`} type="number" min="1800" max="2200" disabled={value.non_vintage === 'true'} value={value.vintage} onChange={(event) => onChange({ ...value, vintage: event.target.value })} /></label><label className="check-field"><input name={`${prefix}_non_vintage`} type="checkbox" checked={value.non_vintage === 'true'} onChange={(event) => onChange({ ...value, non_vintage: String(event.target.checked) })} /> Non-vintage</label></div>{matches.length > 0 && <p className="workflow-context">This wine is already in the collection. We’ll add bottles to it without changing its wine information.</p>}<details className="more-details"><summary>More wine information</summary><div className="details-fields"><div className="field-grid">{field('style','Style')}{field('category','Type')}{field('sweetness','Sweetness')}{field('country','Country')}<label>State<select name={`${prefix}_state`} value={value.state ?? ''} onChange={(event) => onChange({ ...value, state: event.target.value })}><option value="">Not specified</option>{US_STATES.map(([code]) => <option key={code}>{code}</option>)}</select></label><label>Closure<select name={`${prefix}_closure`} value={value.closure ?? 'Cork'} onChange={(event) => onChange({ ...value, closure: event.target.value })}><option>Cork</option><option>Screwtop</option></select></label></div>{field('vineyard','Vineyard')}{field('blend_description','Varietal or blend')}{[['official_winery_notes','Official winery notes'],['personal_notes','Our notes']].map(([name,label]) => <label key={name}>{label}<textarea name={`${prefix}_${name}`} value={value[name] ?? ''} onChange={(event) => onChange({ ...value, [name]: event.target.value })} /></label>)}</div></details></div>
}
