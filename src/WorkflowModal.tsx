import { FormEvent, useState } from 'react'
import type { CellarData } from './lib/cellar-data'
import { supabase } from './lib/supabase'
import { createUniqueId } from './lib/unique-id'
import type { QuickAction } from './lib/types'

const LABELS: Record<QuickAction, string> = {
  'add-wine': 'Add Wine',
  'record-purchase': 'Record Purchase',
  'open-bottle': 'Open a Bottle',
  'add-winery': 'Add Winery',
  'add-winery-visit': 'Add Winery Visit',
}

const localDate = () => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

const localDateTime = () => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
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
  onClose,
  onSaved,
}: {
  action: QuickAction
  householdId: string
  data: CellarData
  onClose: () => void
  onSaved: () => Promise<void>
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
          region: optional(form, 'region'),
          appellation: optional(form, 'appellation'),
          vineyard: optional(form, 'vineyard'),
          closure: optional(form, 'closure'),
          blend_description: optional(form, 'blend_description'),
          official_winery_notes: optional(form, 'official_winery_notes'),
          personal_notes: optional(form, 'notes'),
        })
        if (error) throw error
      }

      if (action === 'record-purchase') {
        const quantity = Number(form.get('quantity'))
        const unitPrice = numberOrNull(form, 'unit_price')
        const lineTotal = unitPrice === null ? null : Number((quantity * unitPrice).toFixed(2))
        const { error } = await supabase.rpc('record_purchase', {
          p_household_id: householdId,
          p_acquisition_date: String(form.get('acquisition_date')),
          p_purchase_location: optional(form, 'purchase_location'),
          p_selected_by_person_id: optional(form, 'selected_by_person_id'),
          p_purchased_by_person_id: optional(form, 'purchased_by_person_id'),
          p_subtotal: lineTotal,
          p_tax: numberOrNull(form, 'tax'),
          p_discount: numberOrNull(form, 'discount'),
          p_total_cost: numberOrNull(form, 'total_cost') ?? lineTotal,
          p_notes: optional(form, 'notes'),
          p_items: [{
            wine_id: String(form.get('wine_id')),
            quantity,
            unit_price: unitPrice,
            total_cost: lineTotal,
            current_value_per_bottle: numberOrNull(form, 'current_value_per_bottle') ?? unitPrice,
            storage_location_id: String(form.get('storage_location_id')),
            notes: null,
          }],
        })
        if (error) throw error
      }

      if (action === 'open-bottle') {
        const [purchaseItemId, storageLocationId] = String(form.get('bottle_lot')).split('|')
        const reviews = data.people.map((person) => ({ person_id: person.id, rating: numberOrNull(form, `rating_${person.id}`), buy_again: optional(form, `buy_again_${person.id}`), tasting_notes: optional(form, `tasting_notes_${person.id}`) })).filter((review) => review.rating !== null || review.buy_again || review.tasting_notes)
        const { data: openingId, error } = await supabase.rpc('open_bottle_with_reviews', {
          p_household_id: householdId,
          p_purchase_item_id: purchaseItemId,
          p_storage_location_id: storageLocationId,
          p_opened_by_person_id: optional(form, 'opened_by_person_id'),
          p_opened_at: new Date(String(form.get('opened_at'))).toISOString(),
          p_status: String(form.get('status')),
          p_enjoyed_with: optional(form, 'enjoyed_with'),
          p_occasion: optional(form, 'occasion'),
          p_memory_notes: optional(form, 'memory_notes'),
          p_issue_type: optional(form, 'issue_type'),
          p_issue_notes: optional(form, 'issue_notes'),
          p_reviews: reviews,
        })
        if (error) throw error
        const photo = form.get('photo')
        if (photo instanceof File && photo.size > 0) {
          const cleanName = photo.name.replace(/[^a-zA-Z0-9._-]/g, '_')
          const storagePath = `${householdId}/openings/${openingId}/${createUniqueId()}-${cleanName}`
          const upload = await supabase.storage.from('cellar-photos').upload(storagePath, photo, { contentType: photo.type, upsert: false })
          if (upload.error) nonBlockingWarning = `The opening was saved, but the photo was not uploaded: ${upload.error.message}`
          else {
            const saved = await supabase.from('photos').insert({ household_id: householdId, opening_id: openingId, storage_path: storagePath, original_filename: photo.name, mime_type: photo.type, file_size_bytes: photo.size, caption: optional(form, 'photo_caption') })
            if (saved.error) { await supabase.storage.from('cellar-photos').remove([storagePath]); nonBlockingWarning = `The opening was saved, but the photo record failed: ${saved.error.message}` }
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
      if (nonBlockingWarning) window.alert(nonBlockingWarning)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The record could not be saved.')
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
          {action === 'open-bottle' && <OpeningFields data={data} />}
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
  return <><Field label="Winery name" name="name" required /><div className="field-grid"><Field label="Region" name="region" /><Field label="State / province" name="state" /><Field label="Country" name="country" /><Field label="City" name="city" /></div><Field label="Website" name="website_url" type="url" placeholder="https://" /><Notes /></>
}

function WineFields({ data }: { data: CellarData }) {
  return <><label>Winery<select name="winery_id"><option value="">No winery selected</option>{data.wineries.map((winery) => <option key={winery.id} value={winery.id}>{winery.name}</option>)}</select></label><Field label="Wine name" name="name" required /><div className="field-grid"><Field label="Vintage" name="vintage" type="number" min="1800" /><label className="check-field"><input name="non_vintage" type="checkbox" /> Non-vintage</label><Field label="Style" name="style" placeholder="Still, sparkling…" /><Field label="Category" name="category" placeholder="Red, white, rosé…" /><Field label="Sweetness" name="sweetness" /><Field label="Closure" name="closure" /></div><Field label="Country" name="country" /><Field label="State / province" name="state" /><Field label="Region" name="region" /><Field label="Appellation" name="appellation" /><Field label="Vineyard" name="vineyard" /><Field label="Varietal or blend" name="blend_description" /><Notes label="Official winery notes" name="official_winery_notes"/><Notes label="Our notes" name="notes" /></>
}

function PurchaseFields({ data }: { data: CellarData }) {
  if (!data.wines.length || !data.locations.length) return <Prerequisite message="Add at least one wine and one storage location before recording a purchase." />
  return <><label>Wine<select name="wine_id" required defaultValue=""><option value="" disabled>Select a wine</option>{data.wines.map((wine) => <option key={wine.id} value={wine.id}>{wine.wineryName ? `${wine.wineryName} · ` : ''}{wine.nonVintage ? 'NV' : wine.vintage ?? 'Unknown vintage'} · {wine.name}</option>)}</select></label><div className="field-grid"><Field label="Purchase date" name="acquisition_date" type="date" defaultValue={localDate()} required /><Field label="Quantity" name="quantity" type="number" min="0.01" step="0.01" defaultValue="1" required /></div><label>Put bottles in<select name="storage_location_id" required defaultValue=""><option value="" disabled>Select a location</option>{data.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><Field label="Purchased at" name="purchase_location" /><div className="field-grid"><Field label="Price per bottle" name="unit_price" type="number" min="0" step="0.01" /><Field label="Current value per bottle" name="current_value_per_bottle" type="number" min="0" step="0.01" /><Field label="Tax" name="tax" type="number" min="0" step="0.01" /><Field label="Discount" name="discount" type="number" min="0" step="0.01" /><Field label="Final total" name="total_cost" type="number" min="0" step="0.01" /></div><PersonSelect name="purchased_by_person_id" label="Purchased by" data={data} /><PersonSelect name="selected_by_person_id" label="Selected by" data={data} /><Notes /></>
}

function OpeningFields({ data }: { data: CellarData }) {
  if (!data.bottleLots.length) return <Prerequisite message="There are no available bottles to open." />
  return <><label>Bottle and location<select name="bottle_lot" required defaultValue=""><option value="" disabled>Select an available bottle</option>{data.bottleLots.map((lot) => <option key={`${lot.purchaseItemId}-${lot.storageLocationId}`} value={`${lot.purchaseItemId}|${lot.storageLocationId}`}>{lot.wineLabel} · {lot.storageLocationName} ({lot.quantity})</option>)}</select></label><div className="field-grid"><Field label="Opened at" name="opened_at" type="datetime-local" defaultValue={localDateTime()} required /><label>Status<select name="status" defaultValue="finished"><option value="finished">Finished</option><option value="open">Still open</option></select></label></div><PersonSelect name="opened_by_person_id" label="Opened by" data={data} /><Field label="Enjoyed with" name="enjoyed_with" /><Field label="Occasion" name="occasion" /><Notes label="Memory notes" name="memory_notes" /><h3 className="form-section-title">What did everyone think?</h3>{data.people.map(person=><fieldset className="preference-card" key={person.id}><legend>{person.displayName}</legend><label>Rating<select name={`rating_${person.id}`}><option value="">Not rated</option>{[5,4.5,4,3.5,3,2.5,2,1.5,1,.5].map(v=><option key={v} value={v}>{v} / 5</option>)}</select></label><label>Buy again<select name={`buy_again_${person.id}`}><option value="">Not set</option><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">No</option></select></label><label>Personal tasting notes<textarea name={`tasting_notes_${person.id}`} rows={2}/></label></fieldset>)}<label>Opening photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment"/></label><Field label="Photo caption" name="photo_caption"/><label>Issue<select name="issue_type"><option value="">No issue</option><option value="cork_failed">Cork failed</option><option value="corked">Corked</option><option value="oxidized">Oxidized</option><option value="other">Other</option></select></label><Notes label="Issue notes" name="issue_notes" /></>
}

function VisitFields({ data }: { data: CellarData }) {
  if (!data.wineries.length) return <Prerequisite message="Add the winery before recording a visit." />
  return <><label>Winery<select name="winery_id" required defaultValue=""><option value="" disabled>Select a winery</option>{data.wineries.map((winery) => <option key={winery.id} value={winery.id}>{winery.name}</option>)}</select></label><Field label="Visit date" name="visit_date" type="date" defaultValue={localDate()} required /><label>Would visit again<select name="would_visit_again"><option value="">Not set</option><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">No</option></select></label><label className="check-field"><input name="favorite" type="checkbox" /> Favorite visit</label><Notes label="Visit memories" /></>
}

function PersonSelect({ name, label, data }: { name: string; label: string; data: CellarData }) {
  return <label>{label}<select name={name}><option value="">Not specified</option>{data.people.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>
}

function Prerequisite({ message }: { message: string }) {
  return <div className="prerequisite"><strong>One thing first</strong><p>{message}</p></div>
}
