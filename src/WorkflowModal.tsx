import { FormEvent, useState } from 'react'
import type { CellarData } from './lib/cellar-data'
import { supabase } from './lib/supabase'
import { createUniqueId } from './lib/unique-id'
import type { QuickAction } from './lib/types'
import { StateSelect } from './StateSelect'
import { ClosureSelect } from './ClosureSelect'
import { userError, validatePhoto } from './lib/user-error'
import { lotRequiresAgingConfirmation } from './lib/aging-guidance'

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
  onClose,
  onSaved,
  onNotice,
}: {
  action: QuickAction
  householdId: string
  data: CellarData
  initialWineId?: string | null
  onClose: () => void
  onSaved: () => Promise<void>
  onNotice: (message: string, tone?: 'success' | 'warning') => void
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const blocked =
    (action === 'record-purchase' && (!data.wines.length || !data.locations.length)) ||
    (action === 'open-bottle' && !data.bottleLots.length) ||
    (action === 'add-winery-visit' && !data.wineries.length)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || blocked) return
    setBusy(true)
    setMessage('')
    const form = new FormData(event.currentTarget)
    let nonBlockingWarning = ''

    try {
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
      }

      if (action === 'record-purchase') {
        const acquisitionType = String(form.get('acquisition_type')) as 'purchased' | 'gift'
        const quantity = Number(form.get('quantity'))
        const unitPrice = acquisitionType === 'purchased' ? numberOrNull(form, 'unit_price') : null
        const lineTotal = unitPrice === null ? null : Number((quantity * unitPrice).toFixed(2))
        const { error } = await supabase.rpc('record_acquisition', {
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
        if (openedByChoice === 'both') {
          const both = await supabase.from('openings').update({ opened_by_both: true }).eq('household_id', householdId).eq('id', openingId)
          if (both.error) nonBlockingWarning = `The opening was saved, but “Both” could not be recorded: ${both.error.message}`
        }
        const photo = form.get('photo')
        if (photo instanceof File && photo.size > 0) {
          validatePhoto(photo)
          const cleanName = photo.name.replace(/[^a-zA-Z0-9._-]/g, '_')
          const storagePath = `${householdId}/openings/${openingId}/${createUniqueId()}-${cleanName}`
          const upload = await supabase.storage.from('cellar-photos').upload(storagePath, photo, { contentType: photo.type, upsert: false })
          if (upload.error) nonBlockingWarning = 'The opening was saved, but its photo could not be uploaded. You can add it from the opening later.'
          else {
            const saved = await supabase.from('photos').insert({ household_id: householdId, opening_id: openingId, storage_path: storagePath, original_filename: photo.name, mime_type: photo.type, file_size_bytes: photo.size, caption: optional(form, 'photo_caption') })
            if (saved.error) { await supabase.storage.from('cellar-photos').remove([storagePath]); nonBlockingWarning = 'The opening was saved, but its photo could not be attached. You can add it from the opening later.' }
          }
        }
        }
      }

      if (action === 'add-winery-visit') {
        const { error } = await supabase.from('winery_visits').insert({
          household_id: householdId,
          winery_id: String(form.get('winery_id')),
          visit_date: String(form.get('visit_date')),
          notes: optional(form, 'notes'),
          favorite: form.get('favorite') === 'on',
          would_visit_again: optional(form, 'would_visit_again'),
        })
        if (error) throw error
      }

      await onSaved()
      onClose()
      onNotice(nonBlockingWarning || `${LABELS[action]} saved.`, nonBlockingWarning ? 'warning' : 'success')
    } catch (error) {
      setMessage(userError(error, 'The record could not be saved. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section className="workflow-modal workflow-form-modal" role="dialog" aria-modal="true" aria-labelledby="workflow-title">
        <div className="sheet-header">
          <div><p className="eyebrow burgundy">PRIVATE COLLECTION</p><h2 id="workflow-title">{LABELS[action]}</h2></div>
          <button className="icon-close" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>
        <form className="workflow-form" onSubmit={submit}>
          {action === 'add-winery' && <WineryFields />}
          {action === 'add-wine' && <WineFields data={data} />}
          {action === 'record-purchase' && <PurchaseFields data={data} />}
          {action === 'open-bottle' && <OpeningFields data={data} initialWineId={initialWineId} />}
          {action === 'add-winery-visit' && <VisitFields data={data} />}
          {message && <p className="form-message error" role="alert">{message}</p>}
          <div className="form-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary-button" disabled={busy || blocked}>{busy ? 'Saving…' : 'Save'}</button></div>
        </form>
      </section>
    </div>
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

function PurchaseFields({ data }: { data: CellarData }) {
  const [acquisitionType, setAcquisitionType] = useState<'purchased' | 'gift'>('purchased')
  if (!data.wines.length || !data.locations.length) return <Prerequisite message="Add at least one wine and one storage location before recording a purchase." />
  const rack = data.locations.find((location) => location.name.toLowerCase() === 'rack') ?? data.locations[0]
  return <><ChoiceToggle name="acquisition_type" label="Coming in" value={acquisitionType} options={[['purchased', 'Purchased'], ['gift', 'Gift']]} onChange={(value) => setAcquisitionType(value as 'purchased' | 'gift')} /><label>Wine<select name="wine_id" required defaultValue=""><option value="" disabled>Select a wine</option>{data.wines.map((wine) => <option key={wine.id} value={wine.id}>{wine.wineryName ? `${wine.wineryName} · ` : ''}{wine.nonVintage ? 'NV' : wine.vintage ?? 'Unknown vintage'} · {wine.name}</option>)}</select></label><div className="field-grid"><Field label={acquisitionType === 'gift' ? 'Date received' : 'Purchase date'} name="acquisition_date" type="date" defaultValue={localDate()} required={acquisitionType === 'purchased'} /><Field label="Quantity" name="quantity" type="number" min="1" step="1" defaultValue="1" required /></div><label>Put bottles in<select name="storage_location_id" required defaultValue={rack.id}>{data.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>{acquisitionType === 'gift' ? <><Field label="Gift from" name="gift_from" /><Notes label="Occasion / Note" /></> : <><Field label="Purchased at" name="purchase_location" /><details className="more-details"><summary>More details</summary><div className="details-fields"><div className="field-grid"><Field label="Price per bottle" name="unit_price" type="number" min="0" step="0.01" /><Field label="Current value per bottle" name="current_value_per_bottle" type="number" min="0" step="0.01" /><Field label="Tax" name="tax" type="number" min="0" step="0.01" /><Field label="Discount" name="discount" type="number" min="0" step="0.01" /><Field label="Final total" name="total_cost" type="number" min="0" step="0.01" /></div><PersonSelect name="purchased_by_person_id" label="Purchased by" data={data} /><PersonSelect name="selected_by_person_id" label="Selected by" data={data} /><Notes /></div></details></>}</>
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
  return <><ChoiceToggle name="departure_type" label="Going out" value={departureType} options={[['opened', 'Opened'], ['gifted', 'Gifted']]} onChange={(value) => setDepartureType(value as 'opened' | 'gifted')} /><label>Bottle and location<select name="bottle_lot" required value={lotValue} onChange={(event) => setLotValue(event.target.value)}><option value="" disabled>Select an available bottle</option>{data.bottleLots.map((lot) => <option key={`${lot.purchaseItemId}-${lot.storageLocationId}`} value={`${lot.purchaseItemId}|${lot.storageLocationId}`}>{lot.wineLabel} · {lot.storageLocationName} ({lot.quantity}{lot.agingQuantity ? ` · ${lot.agingQuantity} Aging` : ''})</option>)}</select></label>{needsAgingConfirmation && <label className="aging-departure-warning"><input type="checkbox" name="confirm_aging" required /> <span><strong>This is an Aging bottle.</strong> Confirm that you want to remove it before its hold date{activeLot?.earliestHoldUntilYear ? ` (${activeLot.earliestHoldUntilYear})` : ''}.</span></label>}{departureType === 'gifted' ? <><div className="field-grid"><Field label="Gifted to" name="gifted_to" required /><Field label="Date" name="gifted_on" type="date" defaultValue={localDate()} required /></div><Notes label="Occasion / Note" name="occasion_note" /></> : <><div className="field-grid"><Field label="Opening date" name="opened_at" type="date" defaultValue={localDate()} required /><label>Opened by<select name="opened_by_choice"><option value="">Not specified</option>{kayla&&<option value={kayla.id}>Kayla</option>}{scott&&<option value={scott.id}>Scott</option>}<option value="both">Both</option></select></label></div><label>Status<select name="status" defaultValue="finished"><option value="finished">Finished</option><option value="open">Still open</option></select></label><Notes label="Memory notes" name="memory_notes" /><h3 className="form-section-title">What did everyone think?</h3>{data.people.map(person=><fieldset className="preference-card" key={person.id}><legend>{person.displayName}</legend><label>Rating<select name={`rating_${person.id}`}><option value="">Not rated</option>{[5,4.5,4,3.5,3,2.5,2,1.5,1,.5].map(v=><option key={v} value={v}>{v} / 5</option>)}</select></label><label>Buy again<select name={`buy_again_${person.id}`}><option value="">Not set</option><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">No</option></select></label><label>Personal tasting notes<textarea name={`tasting_notes_${person.id}`} rows={2}/></label></fieldset>)}<label className="photo-picker"><span className="photo-picker-icon" aria-hidden="true">📷</span><span><strong>Opening photo</strong><small>Take or choose a photo</small></span><input name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment"/></label><details className="more-details"><summary>More details</summary><div className="details-fields"><Field label="Enjoyed with" name="enjoyed_with" /><Field label="Occasion" name="occasion" /><Field label="Photo caption" name="photo_caption"/><label>Issue<select name="issue_type"><option value="">No issue</option><option value="cork_failed">Cork failed</option><option value="corked">Corked</option><option value="oxidized">Oxidized</option><option value="other">Other</option></select></label><Notes label="Issue notes" name="issue_notes" /></div></details></>}</>
}

function ChoiceToggle({ name, label, value, options, onChange }: { name:string; label:string; value:string; options:Array<[string,string]>; onChange:(value:string)=>void }) {
  return <fieldset className="choice-toggle"><legend>{label}</legend><div>{options.map(([optionValue, optionLabel]) => <label key={optionValue} className={value === optionValue ? 'active' : ''}><input type="radio" name={name} value={optionValue} checked={value === optionValue} onChange={() => onChange(optionValue)} /><span>{optionLabel}</span></label>)}</div></fieldset>
}

function VisitFields({ data }: { data: CellarData }) {
  if (!data.wineries.length) return <Prerequisite message="Add the winery before recording a visit." />
  return <><label>Winery<select name="winery_id" required defaultValue=""><option value="" disabled>Select a winery</option>{data.wineries.map((winery) => <option key={winery.id} value={winery.id}>{winery.name}</option>)}</select></label><Field label="Visit date" name="visit_date" type="date" defaultValue={localDate()} required /><Notes label="Visit memories" /><details className="more-details"><summary>More details</summary><div className="details-fields"><label>Would visit again<select name="would_visit_again"><option value="">Not set</option><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">No</option></select></label><label className="check-field"><input name="favorite" type="checkbox" /> Favorite visit</label></div></details></>
}

function PersonSelect({ name, label, data }: { name: string; label: string; data: CellarData }) {
  return <label>{label}<select name={name}><option value="">Not specified</option>{data.people.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>
}

function Prerequisite({ message }: { message: string }) {
  return <div className="prerequisite"><strong>One thing first</strong><p>{message}</p></div>
}
