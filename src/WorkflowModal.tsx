import { MoveBottleModal } from './MoveBottleModal'
import type { EntryCompletion } from './lib/entry-types'
import { AcquisitionModal } from './AcquisitionModal'
import { preferredLot, lotDescription } from './lib/bottle-selection'
import { FormEvent, useRef, useState } from 'react'
import type { CellarData } from './lib/cellar-data'
import { supabase } from './lib/supabase'
import { createPhotoUpload } from './lib/photo-upload'
import { markFormSaved } from './lib/unsaved-changes'
import type { QuickAction } from './lib/types'
import { StateSelect } from './StateSelect'
import { userError, validatePhoto } from './lib/user-error'
import { lotRequiresAgingConfirmation } from './lib/aging-guidance'
import { finishSuccessfulAction } from './lib/interaction'
import { ModalLayer } from './OverlayLayer'
import { StarRatingInput } from './StarRating'
import { PhotoPicker } from './PhotoPicker'

const LABELS: Record<QuickAction, string> = {
  'add-wine': 'Add Wine',
  'record-purchase': 'Add Bottles',
  'move-bottles': 'Change Location',
  'open-bottle': 'Open / Gift Bottle',
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
  initialDepartureType = 'opened',
  initialWineryId = null,
  initialVisitId = null,
  initialDate = null,
  initialTripId = null,
  initialPurchaseId,
  initialLocationId,
  onComplete,
  onClose,
  onSaved,
  onNotice,
}: {
  action: QuickAction
  householdId: string
  data: CellarData
  initialDepartureType?: 'opened' | 'gifted'
  initialWineId?: string | null
  initialWineryId?: string | null
  initialVisitId?: string | null
  initialDate?: string | null
  initialTripId?: string | null
  initialPurchaseId?: string | null
  initialLocationId?: string | null
  onComplete?: (completion: EntryCompletion) => void
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
  const [unconfirmed, setUnconfirmed] = useState(false)
  const uncertain = useRef(false)
  const warning = useRef('')
  const complete = async () => {
    await finishSuccessfulAction({ form: savingForm.current, refresh: onSaved, finish: onClose, notice: onNotice, message: warning.current || 'Saved successfully.', tone: warning.current ? 'warning' : 'success' })
  }
  const checkUnconfirmedSave = async () => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true)
    try {
      await onSaved()
      // The user is explicitly leaving to check the outcome, not retrying a mutation.
      markFormSaved(savingForm.current)
      onClose()
      onNotice('Check the refreshed record and History before recording this again; the previous save could not be confirmed.', 'warning')
    } catch {
      setMessage('The screen could not refresh. Try Refresh & Check again; this will not repeat the save.')
    } finally { inFlight.current = false; setBusy(false) }
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
    if (!supabase || blocked || inFlight.current || saved.current || uncertain.current) return
    inFlight.current = true
    setBusy(true)
    setMessage('')
    savingForm.current = event.currentTarget
    const form = new FormData(event.currentTarget)
    let nonBlockingWarning = ''
    let mutationStarted = false

    try {
      const photo = form.get('photo')
      if (photo instanceof File && photo.size > 0) validatePhoto(photo)
      if (action === 'add-winery-visit' && optional(form, 'trip_id') && !data.trips.some((trip) => trip.id === optional(form, 'trip_id'))) throw new Error('Choose a valid Travel Journal trip.')
      if (action === 'add-winery') {
        mutationStarted = true
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

      if (action === 'open-bottle') {
        mutationStarted = true
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
        mutationStarted = true
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
      } else if (mutationStarted && !/^[0-9A-Z]{5}$/.test(String((error as {code?:string})?.code ?? ''))) {
        uncertain.current = true; setUnconfirmed(true)
        setMessage('Save could not be confirmed. Refresh and check the record and History before recording this again.')
      } else setMessage(userError(error, 'The record could not be saved. Please try again.'))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  if (action === 'move-bottles') return <MoveBottleModal wineId={initialWineId ?? ''} householdId={householdId} data={data} onClose={onClose} onSaved={onSaved} onNotice={onNotice} />
  if (action === 'add-wine' || action === 'record-purchase') return <AcquisitionModal initialPurchaseId={initialPurchaseId} initialLocationId={initialLocationId} onComplete={onComplete} action={action} householdId={householdId} data={data} initialWineryId={initialWineryId} initialVisitId={initialVisitId} initialDate={initialDate} initialTripId={initialTripId} onClose={onClose} onSaved={onSaved} onNotice={onNotice} />

  return (
    <ModalLayer layer="action" onDismiss={onClose} dismissible={!busy} surfaceClassName="workflow-modal workflow-form-modal" ariaLabelledBy="workflow-title">
        <div className="sheet-header">
          <div><p className="eyebrow burgundy">PRIVATE COLLECTION</p><h2 id="workflow-title">{action==='open-bottle'&&initialDepartureType==='gifted'?'Gift Bottle':LABELS[action]}</h2></div>
          <button className="icon-close" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>
        <form className="workflow-form" onSubmit={submit}>
          <fieldset className="workflow-fields" disabled={busy || saved.current || unconfirmed}>
          {action === 'add-winery' && <WineryFields />}
          {action === 'open-bottle' && <OpeningFields data={data} initialWineId={initialWineId} initialDepartureType={initialDepartureType} />}
          {action === 'add-winery-visit' && <VisitFields data={data} initialWineryId={initialWineryId} />}
          </fieldset>
          {message && <p className="form-message error" role="alert">{message}</p>}
          <div className="form-actions"><button type="button" data-discard className="secondary-button" onClick={onClose} disabled={busy}>{saved.current ? 'Done' : 'Cancel'}</button>{unconfirmed ? <button type="button" className="primary-button" disabled={busy} onClick={() => void checkUnconfirmedSave()}>{busy ? 'Refreshing…' : 'Refresh & Check'}</button> : photoFailed ? <button type="button" className="primary-button" disabled={busy} onClick={() => void retryPhoto()}>{busy ? 'Adding photo…' : 'Retry Photo'}</button> : <button className="primary-button" disabled={busy || blocked || saved.current}>{busy ? 'Saving…' : 'Save'}</button>}</div>
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

function OpeningFields({ data, initialWineId, initialDepartureType }: { data: CellarData; initialWineId: string | null; initialDepartureType: 'opened'|'gifted' }) {
  const [departureType, setDepartureType] = useState<'opened' | 'gifted'>(initialDepartureType)
  const [wineId, setWineId] = useState(initialWineId ?? '')
  const [changingWine, setChangingWine] = useState(!initialWineId)
  const [search, setSearch] = useState('')
  const selectedLot = preferredLot(data.bottleLots, initialWineId)
  const defaultLot = selectedLot ? `${selectedLot.purchaseItemId}|${selectedLot.storageLocationId}` : ''
  const [lotValue, setLotValue] = useState(defaultLot)
  const relevantLots = wineId ? data.bottleLots.filter((lot) => lot.wineId === wineId) : []
  const choices = [preferredLot(relevantLots,wineId),...relevantLots].filter((lot): lot is NonNullable<typeof lot> => !!lot && lot.wineId===wineId).filter((lot,index,lots) => lots.findIndex(other =>
    other.storageLocationId===lot.storageLocationId &&
    data.purchases.find(p=>p.id===other.purchaseId)?.acquisitionDate===data.purchases.find(p=>p.id===lot.purchaseId)?.acquisitionDate &&
    lotRequiresAgingConfirmation(other)===lotRequiresAgingConfirmation(lot) &&
    other.earliestHoldUntilYear===lot.earliestHoldUntilYear
  )===index)
  const availableWines = data.wines.filter((wine) => data.bottleLots.some((lot) => lot.wineId === wine.id) && `${wine.name} ${wine.wineryName ?? ''} ${wine.vintage ?? ''}`.toLowerCase().includes(search.toLowerCase()))
  const activeLot = data.bottleLots.find((lot) => `${lot.purchaseItemId}|${lot.storageLocationId}` === lotValue)
  const needsAgingConfirmation = lotRequiresAgingConfirmation(activeLot)
  const kayla = data.people.find((person) => person.displayName.toLowerCase() === 'kayla')
  const scott = data.people.find((person) => person.displayName.toLowerCase() === 'scott')
  return <>{initialDepartureType==='gifted'?<input type="hidden" name="departure_type" value="gifted"/>:<ChoiceToggle name="departure_type" label="Going out" value={departureType} options={[['opened', 'Opened'], ['gifted', 'Gifted']]} onChange={(value) => setDepartureType(value as 'opened' | 'gifted')} />}{changingWine ? <div className="bottle-wine-picker"><label>Search wines<input name="wine_search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label>Wine<select name="selected_wine" value={wineId} required onChange={(event) => { const id=event.target.value; setWineId(id); const lot=preferredLot(data.bottleLots,id); setLotValue(lot ? `${lot.purchaseItemId}|${lot.storageLocationId}` : ''); setChangingWine(false) }}><option value="">Choose a wine</option>{availableWines.map((wine) => <option key={wine.id} value={wine.id}>{wine.wineryName} · {wine.name} · {wine.nonVintage ? 'NV' : wine.vintage ?? 'Vintage unknown'}</option>)}</select></label></div> : <div className="workflow-context"><strong>{data.wines.find((wine) => wine.id === wineId)?.name}</strong><button type="button" className="text-button" onClick={() => setChangingWine(true)}>Change Wine</button></div>}{choices.length<=1&&activeLot?<><input type="hidden" name="bottle_lot" value={lotValue}/><p className="workflow-context">From {activeLot.storageLocationName}{needsAgingConfirmation?' · Aging':''}</p></>:<label>Bottle and location<select name="bottle_lot" required value={lotValue} onChange={(event) => setLotValue(event.target.value)}><option value="" disabled>Select an available bottle</option>{choices.map((lot) => <option key={`${lot.purchaseItemId}-${lot.storageLocationId}`} value={`${lot.purchaseItemId}|${lot.storageLocationId}`}>{lotDescription(lot,data)}</option>)}</select></label>}{needsAgingConfirmation && <label className="aging-departure-warning"><input key={lotValue} type="checkbox" name="confirm_aging" required /> <span><strong>This is an Aging bottle.</strong> Confirm removing this bottle that we set aside to age{activeLot?.earliestHoldUntilYear ? ` (hold until ${activeLot.earliestHoldUntilYear})` : ''}.</span></label>}<fieldset className="workflow-fields" hidden={departureType !== 'gifted'} disabled={departureType !== 'gifted'}><div className="field-grid departure-primary-fields"><Field label="Gifted to" name="gifted_to" required /><Field label="Date" name="gifted_on" type="date" defaultValue={localDate()} required /></div><Notes label="Occasion / Note" name="occasion_note" /></fieldset><fieldset className="workflow-fields" hidden={departureType !== 'opened'} disabled={departureType !== 'opened'}><div className="field-grid departure-primary-fields"><Field label="Opening date" name="opened_at" type="date" defaultValue={localDate()} required /><label>Opened by<select name="opened_by_choice"><option value="">Not specified</option>{kayla&&<option value={kayla.id}>Kayla</option>}{scott&&<option value={scott.id}>Scott</option>}<option value="both">Both</option></select></label></div><details className="more-details"><summary>Tasting notes — now or later</summary><div className="details-fields"><label>Status<select name="status" defaultValue="open"><option value="open">Still open</option><option value="finished">Finished</option></select></label><Notes label="Memory notes" name="memory_notes" /><h3 className="form-section-title">What did everyone think?</h3>{data.people.map(person=><fieldset className="preference-card" key={person.id}><legend>{person.displayName}</legend><StarRatingInput name={`rating_${person.id}`} /><label>Buy again<select name={`buy_again_${person.id}`}><option value="">Not set</option><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">No</option></select></label><label>Personal tasting notes<textarea name={`tasting_notes_${person.id}`} rows={2}/></label></fieldset>)}</div></details><PhotoPicker label="Opening photo" /><details className="more-details"><summary>More details</summary><div className="details-fields"><Field label="Enjoyed with" name="enjoyed_with" /><Field label="Occasion" name="occasion" /><Field label="Photo caption" name="photo_caption"/><label>Issue<select name="issue_type"><option value="">No issue</option><option value="cork_failed">Cork failed</option><option value="corked">Corked</option><option value="oxidized">Oxidized</option><option value="other">Other</option></select></label><Notes label="Issue notes" name="issue_notes" /></div></details></fieldset></>
}

function ChoiceToggle({ name, label, value, options, onChange }: { name:string; label:string; value:string; options:Array<[string,string]>; onChange:(value:string)=>void }) {
  return <fieldset className="choice-toggle"><legend>{label}</legend><div>{options.map(([optionValue, optionLabel]) => <label key={optionValue} className={value === optionValue ? 'active' : ''}><input type="radio" name={name} value={optionValue} checked={value === optionValue} onChange={() => onChange(optionValue)} /><span>{optionLabel}</span></label>)}</div></fieldset>
}

function VisitFields({ data, initialWineryId }: { data: CellarData; initialWineryId: string | null }) {
  if (!data.wineries.length) return <Prerequisite message="Add the winery before recording a visit." />
  return <><label>Winery<select name="winery_id" required defaultValue={initialWineryId ?? ''}><option value="" disabled>Select a winery</option>{data.wineries.map((winery) => <option key={winery.id} value={winery.id}>{winery.name}</option>)}</select></label><Field label="Visit date" name="visit_date" type="date" defaultValue={localDate()} required /><label>Travel Journal trip<select name="trip_id" defaultValue=""><option value="">No linked trip</option>{data.trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.name} · {trip.startDate}</option>)}</select></label><Notes label="Visit memories" /><PhotoPicker label="Visit photo" hint="Take Photo or Choose from Photos · optional" /><div className="field-grid"><Field label="Photo caption" name="photo_caption" /><Field label="Photo date" name="photographed_at" type="date" /></div><details className="more-details"><summary>More details</summary><div className="details-fields"><label>Would visit again<select name="would_visit_again"><option value="">Not set</option><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">No</option></select></label><label className="check-field"><input name="favorite" type="checkbox" /> Favorite visit</label></div></details></>
}


function Prerequisite({ message }: { message: string }) {
  return <div className="prerequisite"><strong>One thing first</strong><p>{message}</p></div>
}
