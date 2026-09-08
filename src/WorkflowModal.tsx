import { FormEvent, useRef, useState } from 'react'
import type { CellarData } from './lib/cellar-data'
import { supabase } from './lib/supabase'
import { createPhotoUpload } from './lib/photo-upload'
import { markFormSaved } from './lib/unsaved-changes'
import type { QuickAction } from './lib/types'
import { StateSelect } from './StateSelect'
import { ClosureSelect } from './ClosureSelect'
import { userError, validatePhoto } from './lib/user-error'
import { lotRequiresAgingConfirmation } from './lib/aging-guidance'
import { finishSuccessfulAction } from './lib/interaction'
import { ModalLayer } from './OverlayLayer'
import { StarRatingInput } from './StarRating'
import { PhotoPicker } from './PhotoPicker'

const LABELS: Record<QuickAction, string> = {
  'add-wine': 'Add Wine',
  'record-purchase': 'Add Bottles',
  'open-bottle': 'Bottle Leaving',
  'add-winery': 'Add Winery',
  'add-winery-visit': 'Add Winery Visit',
}

const localDate = () => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

const optional = (form: FormData, name: string) => String(form.get(name) ?? '').trim() || null
const numberOrNull = (form: FormData, name: string) => {
  const value = optional(form, name)
  return value === null ? null : Number(value)
}

export function WorkflowModal({
  action,
  householdId,
  data,
  initialWineId = null,
  initialWineryId = null,
  initialVisitId = null,
  initialDate = null,
  initialTripId = null,
  onClose,
  onSaved,
  onNotice,
}: {
  action: QuickAction
  householdId: string
  data: CellarData
  initialWineId?: string | null
  initialWineryId?: string | null
  initialVisitId?: string | null
  initialDate?: string | null
  initialTripId?: string | null
  onClose: () => void
  onSaved: () => Promise<void>
  onNotice: (message: string, tone?: 'success' | 'warning') => void
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const savingForm = useRef<HTMLFormElement | null>(null)
  const saved = useRef(false)
  const inFlight = useRef(false)
  const pendingPhoto = useRef<null | (() => Promise<void>)>(null)
  const [photoFailed, setPhotoFailed] = useState(false)
  const warning = useRef('')
  const complete = async () => {
    await finishSuccessfulAction({ form: savingForm.current, refresh: onSaved, finish: onClose, notice: onNotice, message: warning.current || 'Saved successfully.', tone: warning.current ? 'warning' : 'success' })
  }
  const retryPhoto = async () => {
    if (inFlight.current || !pendingPhoto.current) return
    inFlight.current = true; setBusy(true)
    try {
      await pendingPhoto.current()
      pendingPhoto.current = null
      setPhotoFailed(false)
      await complete()
    } catch {
      setMessage('Record saved; photo not added. Retry Photo will only retry the photo.')
    } finally { inFlight.current = false; setBusy(false) }
  }
  const blocked =
    (action === 'record-purchase' && (!data.wines.length || !data.locations.length)) ||
    (action === 'open-bottle' && !data.bottleLots.length) ||
    (action === 'add-winery-visit' && !data.wineries.length)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || blocked || inFlight.current || saved.current) return
    inFlight.current = true
    setBusy(true)
    setMessage('')
    savingForm.current = event.currentTarget
    const form = new FormData(event.currentTarget)
    let nonBlockingWarning = ''

    try {
      const photo = form.get('photo')
      if (photo instanceof File && photo.size > 0) validatePhoto(photo)
      if (action === 'add-winery-visit' && optional(form, 'trip_id') && !data.trips.some((trip) => trip.id === optional(form, 'trip_id'))) throw new Error('Choose a valid Travel Journal trip.')
      if (action === 'add-winery') {
        const { error } = await supabase.from('wineries').insert({
          household_id: householdId,
          name: String(form.get('name')).trim(),
          country: optional(form, 'country'),
          state: optional(form, 'state'),
          region: optional(form, 'region'),
          city: optional(form, 'city'),
          website_url: optional(form, 'website_url'),
          notes: optional(form, 'notes'),
        })
        if (error) throw error
        saved.current = true
      }

      if (action === 'add-wine') {
        const nonVintage = form.get('non_vintage') === 'on'
        const { error } = await supabase.from('wines').insert({
          household_id: householdId,
          winery_id: optional(form, 'winery_id'),
          name: String(form.get('name')).trim(),
          vintage: nonVintage ? null : numberOrNull(form, 'vintage'),
          non_vintage: nonVintage,
          style: optional(form, 'style'),
          category: optional(form, 'category'),
          sweetness: optional(form, 'sweetness'),
          country: optional(form, 'country'),
          state: optional(form, 'state'),
          vineyard: optional(form, 'vineyard'),
          closure: optional(form, 'closure'),
          blend_description: optional(form, 'blend_description'),
          official_winery_notes: optional(form, 'official_winery_notes'),
          personal_notes: optional(form, 'notes'),
        })
        if (error) throw error
        saved.current = true
      }

      if (action === 'record-purchase') {
        const acquisitionType = String(form.get('acquisition_type')) as 'purchased' | 'gift'
        const quantity = Number(form.get('quantity'))
        const unitPrice = acquisitionType === 'purchased' ? numberOrNull(form, 'unit_price') : null
        const lineTotal = unitPrice === null ? null : Number((quantity * unitPrice).toFixed(2))
        const { data: purchaseId, error } = await supabase.rpc('record_acquisition', {
          p_household_id: householdId,
          p_acquisition_type: acquisitionType,
          p_acquisition_date: optional(form, 'acquisition_date'),
          p_purchase_location: acquisitionType === 'purchased' ? optional(form, 'purchase_location') : null,
          p_gift_from: acquisitionType === 'gift' ? optional(form, 'gift_from') : null,
          p_selected_by_person_id: acquisitionType === 'purchased' ? optional(form, 'selected_by_person_id') : null,
          p_purchased_by_person_id: acquisitionType === 'purchased' ? optional(form, 'purchased_by_person_id') : null,
          p_subtotal: lineTotal,
          p_tax: acquisitionType === 'purchased' ? numberOrNull(form, 'tax') : null,
          p_discount: acquisitionType === 'purchased' ? numberOrNull(form, 'discount') : null,
          p_total_cost: acquisitionType === 'purchased' ? numberOrNull(form, 'total_cost') ?? lineTotal : null,
          p_notes: optional(form, 'notes'),
          p_items: [{
            wine_id: String(form.get('wine_id')),
            quantity,
            unit_price: unitPrice,
            total_cost: lineTotal,
            current_value_per_bottle: acquisitionType === 'purchased' ? numberOrNull(form, 'current_value_per_bottle') ?? unitPrice : null,
            storage_location_id: String(form.get('storage_location_id')),
            notes: null,
          }],
        })
        if (error) throw error
        saved.current = true
        if (initialVisitId && purchaseId) {
          const linked = await supabase.from('purchases').update({ winery_visit_id: initialVisitId }).eq('household_id', householdId).eq('id', purchaseId)
          if (linked.error) nonBlockingWarning = 'The bottles were saved, but could not be linked to this visit. You can link the purchase from Visit Detail.'
          else if (initialTripId) {
            const trip = data.trips.find((item) => item.id === initialTripId)
            const tripLink = trip ? await supabase.from('travel_references').insert({ household_id: householdId, purchase_id: purchaseId, external_system: 'travel-journal', external_entity_type: 'trip', external_id: trip.id, display_label: trip.name, deep_link_path: null }) : null
            if (tripLink?.error) nonBlockingWarning = 'The purchase is linked to the visit, but its Travel Journal trip link could not be copied.'
          }
        }
      }

      if (action === 'open-bottle') {
        const [purchaseItemId, storageLocationId] = String(form.get('bottle_lot')).split('|')
        if (form.get('departure_type') === 'gifted') {
          const { error } = await supabase.rpc('gift_bottle_v2', {
            p_household_id: householdId,
            p_purchase_item_id: purchaseItemId,
            p_storage_location_id: storageLocationId,
            p_gifted_to: String(form.get('gifted_to')).trim(),
            p_gifted_on: String(form.get('gifted_on')),
            p_occasion_note: optional(form, 'occasion_note'),
            p_confirm_aging: form.get('confirm_aging') === 'on',
          })
          if (error) throw error
          saved.current = true
        } else {
        const openedByChoice = optional(form, 'opened_by_choice')
        const reviews = data.people.map((person) => ({ person_id: person.id, rating: numberOrNull(form, `rating_${person.id}`), buy_again: optional(form, `buy_again_${person.id}`), tasting_notes: optional(form, `tasting_notes_${person.id}`) })).filter((review) => review.rating !== null || review.buy_again || review.tasting_notes)
        const { data: openingId, error } = await supabase.rpc('open_bottle_with_reviews_v2', {
          p_household_id: householdId,
          p_purchase_item_id: purchaseItemId,
          p_storage_location_id: storageLocationId,
          p_opened_by_person_id: openedByChoice === 'both' ? null : openedByChoice,
          p_opened_at: new Date(`${String(form.get('opened_at'))}T12:00:00`).toISOString(),
          p_status: String(form.get('status')),
          p_enjoyed_with: optional(form, 'enjoyed_with'),
          p_occasion: optional(form, 'occasion'),
          p_memory_notes: optional(form, 'memory_notes'),
          p_issue_type: optional(form, 'issue_type'),
          p_issue_notes: optional(form, 'issue_notes'),
          p_reviews: reviews,
          p_confirm_aging: form.get('confirm_aging') === 'on',
        })
        if (error) throw error
        saved.current = true
        if (photo instanceof File && photo.size > 0) pendingPhoto.current = createPhotoUpload(supabase, photo, householdId, `openings/${openingId}`, { opening_id: openingId }, { caption: optional(form, 'photo_caption') })
        if (openedByChoice === 'both') {
          const both = await supabase.from('openings').update({ opened_by_both: true }).eq('household_id', householdId).eq('id', openingId)
          if (both.error) nonBlockingWarning = `The opening was saved, but “Both” could not be recorded: ${both.error.message}`
        }
        }
      }

      if (action === 'add-winery-visit') {
        const { data: createdVisit, error } = await supabase.from('winery_visits').insert({
          household_id: householdId,
          winery_id: String(form.get('winery_id')),
          visit_date: String(form.get('visit_date')),
          notes: optional(form, 'notes'),
          favorite: form.get('favorite') === 'on',
          would_visit_again: optional(form, 'would_visit_again'),
        }).select('id').single()
        if (error) throw error
        saved.current = true
        const visitId = String(createdVisit.id), tripId = optional(form, 'trip_id')
        if (photo instanceof File && photo.size > 0) {
          const photographedOn = optional(form, 'photographed_at')
          pendingPhoto.current = createPhotoUpload(supabase, photo, householdId, `visits/${visitId}`, { winery_visit_id: visitId }, { caption: optional(form, 'photo_caption'), photographed_at: photographedOn ? `${photographedOn}T12:00:00` : null, is_hero: true })
        }
        if (tripId) {
          const trip = data.trips.find((item) => item.id === tripId)
          if (!trip) throw new Error('Choose a valid Travel Journal trip.')
          const linked = await supabase.from('travel_references').insert({ household_id: householdId, winery_visit_id: visitId, external_system: 'travel-journal', external_entity_type: 'trip', external_id: trip.id, display_label: trip.name, deep_link_path: null })
          if (linked.error) nonBlockingWarning = 'Visit saved, but its Travel Journal trip could not be linked. Edit the visit to add the trip.'
        }

      }

      warning.current = nonBlockingWarning
      if (pendingPhoto.current) {
        try { await pendingPhoto.current(); pendingPhoto.current = null }
        catch {
          markFormSaved(savingForm.current)
          setPhotoFailed(true)
          setMessage('Record saved; photo not added. Retry Photo will only retry the photo.')
          await onSaved().catch(() => {})
          return
        }
      }
      await complete()
    } catch (error) {
      if (saved.current) {
        warning.current = 'Record saved, but a follow-up step could not finish. Do not save it again. Check the record before adding any missing details.'
        if (pendingPhoto.current) {
          markFormSaved(savingForm.current); setPhotoFailed(true)
          setMessage('Record saved; photo not added. A follow-up step also failed; check the record for missing details. Retry Photo will only retry the photo.')
          await onSaved().catch(() => {})
        } else await complete()
      } else setMessage(userError(error, 'The record could not be saved. Please try again.'))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <ModalLayer layer="action" onDismiss={onClose} dismissible={!busy} surfaceClassName="workflow-modal workflow-form-modal" ariaLabelledBy="workflow-title">
        <div className="sheet-header">
          <div><p className="eyebrow burgundy">PRIVATE COLLECTION</p><h2 id="workflow-title">{LABELS[action]}</h2></div>
          <button className="icon-close" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>
        <form className="workflow-form" onSubmit={submit}>
          <fieldset className="workflow-fields" disabled={busy || saved.current}>
          {action === 'add-winery' && <WineryFields />}
          {action === 'add-wine' && <WineFields data={data} />}
          {action === 'record-purchase' && <PurchaseFields data={data} initialWineryId={initialWineryId} initialVisitId={initialVisitId} initialDate={initialDate} initialTripId={initialTripId} />}
          {action === 'open-bottle' && <OpeningFields data={data} initialWineId={initialWineId} />}
          {action === 'add-winery-visit' && <VisitFields data={data} initialWineryId={initialWineryId} />}
          </fieldset>
          {message && <p className="form-message error" role="alert">{message}</p>}
          <div className="form-actions"><button type="button" data-discard className="secondary-button" onClick={onClose} disabled={busy}>{saved.current ? 'Done' : 'Cancel'}</button>{photoFailed ? <button type="button" className="primary-button" disabled={busy} onClick={() => void retryPhoto()}>{busy ? 'Adding photo…' : 'Retry Photo'}</button> : <button className="primary-button" disabled={busy || blocked || saved.current}>{busy ? 'Saving…' : 'Save'}</button>}</div>
        </form>
    </ModalLayer>
  )
}

function Field({ label, name, type = 'text', required = false, defaultValue, min, step, placeholder }: { label: string; name: string; type?: string; required?: boolean; defaultValue?: string; min?: string; step?: string; placeholder?: string }) {
  return <label>{label}<input name={name} type={type} required={required} defaultValue={defaultValue} min={min} step={step} placeholder={placeholder} /></label>
}

function Notes({ label = 'Notes', name = 'notes' }: { label?: string; name?: string }) {
  return <label className="field-wide">{label}<textarea name={name} rows={3} /></label>
}

function WineryFields() {
  return <><Field label="Winery name" name="name" required /><div className="field-grid"><Field label="City" name="city" /><StateSelect /></div><details className="more-details"><summary>More details</summary><div className="details-fields"><Field label="Region" name="region" /><Field label="Country" name="country" /><Field label="Website" name="website_url" type="url" placeholder="https://" /><Notes /></div></details></>
}

function WineFields({ data }: { data: CellarData }) {
  return <><label>Winery<select name="winery_id"><option value="">No winery selected</option>{data.wineries.map((winery) => <option key={winery.id} value={winery.id}>{winery.name}</option>)}</select></label><Field label="Wine name" name="name" required /><div className="field-grid"><Field label="Vintage" name="vintage" type="number" min="1800" /><label className="check-field paired-check-field"><input name="non_vintage" type="checkbox" /> Non-vintage</label><Field label="Category" name="category" placeholder="Red, white, rosé…" /><Field label="Style" name="style" placeholder="Still, sparkling…" /></div><details className="more-details"><summary>More details</summary><div className="details-fields"><div className="field-grid"><Field label="Sweetness" name="sweetness" /><ClosureSelect /><Field label="Country" name="country" /><StateSelect /></div><Field label="Vineyard" name="vineyard" /><Field label="Varietal or blend" name="blend_description" /><Notes label="Official winery notes" name="official_winery_notes"/><Notes label="Our notes" name="notes" /></div></details></>
}

function PurchaseFields({ data, initialWineryId, initialVisitId, initialDate, initialTripId }: { data: CellarData; initialWineryId: string | null; initialVisitId: string | null; initialDate: string | null; initialTripId: string | null }) {
  const [acquisitionType, setAcquisitionType] = useState<'purchased' | 'gift'>('purchased')
  if (!data.wines.length || !data.locations.length) return <Prerequisite message="Add at least one wine and one storage location before recording a purchase." />
  const rack = data.locations.find((location) => location.name.toLowerCase() === 'rack') ?? data.locations[0]
  const winery = initialWineryId ? data.wineries.find((item) => item.id === initialWineryId) : null
  const wineryWines = initialWineryId ? data.wines.filter((wine) => wine.wineryId === initialWineryId) : data.wines
  const otherWines = initialWineryId ? data.wines.filter((wine) => wine.wineryId !== initialWineryId) : []
  const wineOption = (wine: CellarData['wines'][number]) => <option key={wine.id} value={wine.id}>{wine.wineryName ? `${wine.wineryName} · ` : ''}{wine.nonVintage ? 'NV' : wine.vintage ?? 'Unknown vintage'} · {wine.name}</option>
  return <>{initialVisitId && <div className="workflow-context"><strong>Adding to this winery visit</strong><small>{winery?.name ?? 'Winery'} · {initialDate ?? 'Visit date'}{initialTripId ? ' · Linked trip will be preserved' : ''}</small></div>}<ChoiceToggle name="acquisition_type" label="Coming in" value={acquisitionType} options={[['purchased', 'Purchased'], ['gift', 'Gift']]} onChange={(value) => setAcquisitionType(value as 'purchased' | 'gift')} /><label>Wine<select name="wine_id" required defaultValue=""><option value="" disabled>Select a wine</option>{initialWineryId ? <><optgroup label={winery?.name ?? 'This winery'}>{wineryWines.map(wineOption)}</optgroup>{otherWines.length > 0 && <optgroup label="Other wines">{otherWines.map(wineOption)}</optgroup>}</> : data.wines.map(wineOption)}</select></label><div className="field-grid"><Field label={acquisitionType === 'gift' ? 'Date received' : 'Purchase date'} name="acquisition_date" type="date" defaultValue={initialDate ?? localDate()} required={acquisitionType === 'purchased'} /><Field label="Quantity" name="quantity" type="number" min="1" step="1" defaultValue="1" required /></div><label>Put bottles in<select name="storage_location_id" required defaultValue={rack.id}>{data.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><fieldset className="workflow-fields" hidden={acquisitionType !== 'gift'} disabled={acquisitionType !== 'gift'}><Field label="Gift from" name="gift_from" /><Notes label="Occasion / Note" /></fieldset><fieldset className="workflow-fields" hidden={acquisitionType !== 'purchased'} disabled={acquisitionType !== 'purchased'}><Field label="Purchased at" name="purchase_location" defaultValue={winery?.name} /><details className="more-details"><summary>More details</summary><div className="details-fields"><div className="field-grid"><Field label="Price per bottle" name="unit_price" type="number" min="0" step="0.01" /><Field label="Current value per bottle" name="current_value_per_bottle" type="number" min="0" step="0.01" /><Field label="Tax" name="tax" type="number" min="0" step="0.01" /><Field label="Discount" name="discount" type="number" min="0" step="0.01" /><Field label="Final total" name="total_cost" type="number" min="0" step="0.01" /></div><PersonSelect name="purchased_by_person_id" label="Purchased by" data={data} /><PersonSelect name="selected_by_person_id" label="Selected by" data={data} /><Notes /></div></details></fieldset></>
}

function OpeningFields({ data, initialWineId }: { data: CellarData; initialWineId: string | null }) {
  const [departureType, setDepartureType] = useState<'opened' | 'gifted'>('opened')
  if (!data.bottleLots.length) return <Prerequisite message="There are no available bottles to open." />
  const selectedLot = data.bottleLots.find((lot) => lot.wineId === initialWineId)
  const defaultLot = selectedLot ? `${selectedLot.purchaseItemId}|${selectedLot.storageLocationId}` : ''
  const [lotValue, setLotValue] = useState(defaultLot)
  const activeLot = data.bottleLots.find((lot) => `${lot.purchaseItemId}|${lot.storageLocationId}` === lotValue)
  const needsAgingConfirmation = lotRequiresAgingConfirmation(activeLot)
  const kayla = data.people.find((person) => person.displayName.toLowerCase() === 'kayla')
  const scott = data.people.find((person) => person.displayName.toLowerCase() === 'scott')
  return <><ChoiceToggle name="departure_type" label="Going out" value={departureType} options={[['opened', 'Opened'], ['gifted', 'Gifted']]} onChange={(value) => setDepartureType(value as 'opened' | 'gifted')} /><label>Bottle and location<select name="bottle_lot" required value={lotValue} onChange={(event) => setLotValue(event.target.value)}><option value="" disabled>Select an available bottle</option>{data.bottleLots.map((lot) => <option key={`${lot.purchaseItemId}-${lot.storageLocationId}`} value={`${lot.purchaseItemId}|${lot.storageLocationId}`}>{lot.wineLabel} · {lot.storageLocationName} ({lot.quantity}{lot.agingQuantity ? ` · ${lot.agingQuantity} Aging` : ''})</option>)}</select></label>{needsAgingConfirmation && <label className="aging-departure-warning"><input type="checkbox" name="confirm_aging" required /> <span><strong>This is an Aging bottle.</strong> Confirm that you want to remove it before its hold date{activeLot?.earliestHoldUntilYear ? ` (${activeLot.earliestHoldUntilYear})` : ''}.</span></label>}<fieldset className="workflow-fields" hidden={departureType !== 'gifted'} disabled={departureType !== 'gifted'}><div className="field-grid departure-primary-fields"><Field label="Gifted to" name="gifted_to" required /><Field label="Date" name="gifted_on" type="date" defaultValue={localDate()} required /></div><Notes label="Occasion / Note" name="occasion_note" /></fieldset><fieldset className="workflow-fields" hidden={departureType !== 'opened'} disabled={departureType !== 'opened'}><div className="field-grid departure-primary-fields"><Field label="Opening date" name="opened_at" type="date" defaultValue={localDate()} required /><label>Opened by<select name="opened_by_choice"><option value="">Not specified</option>{kayla&&<option value={kayla.id}>Kayla</option>}{scott&&<option value={scott.id}>Scott</option>}<option value="both">Both</option></select></label></div><label>Status<select name="status" defaultValue="finished"><option value="finished">Finished</option><option value="open">Still open</option></select></label><Notes label="Memory notes" name="memory_notes" /><h3 className="form-section-title">What did everyone think?</h3>{data.people.map(person=><fieldset className="preference-card" key={person.id}><legend>{person.displayName}</legend><StarRatingInput name={`rating_${person.id}`} /><label>Buy again<select name={`buy_again_${person.id}`}><option value="">Not set</option><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">No</option></select></label><label>Personal tasting notes<textarea name={`tasting_notes_${person.id}`} rows={2}/></label></fieldset>)}<PhotoPicker label="Opening photo" /><details className="more-details"><summary>More details</summary><div className="details-fields"><Field label="Enjoyed with" name="enjoyed_with" /><Field label="Occasion" name="occasion" /><Field label="Photo caption" name="photo_caption"/><label>Issue<select name="issue_type"><option value="">No issue</option><option value="cork_failed">Cork failed</option><option value="corked">Corked</option><option value="oxidized">Oxidized</option><option value="other">Other</option></select></label><Notes label="Issue notes" name="issue_notes" /></div></details></fieldset></>
}

function ChoiceToggle({ name, label, value, options, onChange }: { name:string; label:string; value:string; options:Array<[string,string]>; onChange:(value:string)=>void }) {
  return <fieldset className="choice-toggle"><legend>{label}</legend><div>{options.map(([optionValue, optionLabel]) => <label key={optionValue} className={value === optionValue ? 'active' : ''}><input type="radio" name={name} value={optionValue} checked={value === optionValue} onChange={() => onChange(optionValue)} /><span>{optionLabel}</span></label>)}</div></fieldset>
}

function VisitFields({ data, initialWineryId }: { data: CellarData; initialWineryId: string | null }) {
  if (!data.wineries.length) return <Prerequisite message="Add the winery before recording a visit." />
  return <><label>Winery<select name="winery_id" required defaultValue={initialWineryId ?? ''}><option value="" disabled>Select a winery</option>{data.wineries.map((winery) => <option key={winery.id} value={winery.id}>{winery.name}</option>)}</select></label><Field label="Visit date" name="visit_date" type="date" defaultValue={localDate()} required /><label>Travel Journal trip<select name="trip_id" defaultValue=""><option value="">No linked trip</option>{data.trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.name} · {trip.startDate}</option>)}</select></label><Notes label="Visit memories" /><PhotoPicker label="Visit photo" hint="Take Photo or Choose from Photos · optional" /><div className="field-grid"><Field label="Photo caption" name="photo_caption" /><Field label="Photo date" name="photographed_at" type="date" /></div><details className="more-details"><summary>More details</summary><div className="details-fields"><label>Would visit again<select name="would_visit_again"><option value="">Not set</option><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">No</option></select></label><label className="check-field"><input name="favorite" type="checkbox" /> Favorite visit</label></div></details></>
}

function PersonSelect({ name, label, data }: { name: string; label: string; data: CellarData }) {
  return <label>{label}<select name={name}><option value="">Not specified</option>{data.people.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>
}

function Prerequisite({ message }: { message: string }) {
  return <div className="prerequisite"><strong>One thing first</strong><p>{message}</p></div>
}
