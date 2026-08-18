import { FormEvent, useEffect, useState } from 'react'
import type { CellarData, WineRecord, WineryRecord } from './lib/cellar-data'
import { supabase } from './lib/supabase'

type Target = { kind: 'wine'; record: WineRecord } | { kind: 'winery'; record: WineryRecord } | { kind: 'storage' } | { kind: 'history' } | { kind: 'documents' }
type Row = Record<string, unknown>

const optional = (form: FormData, key: string) => String(form.get(key) ?? '').trim() || null
const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_')

export function ManagementModal({ target, householdId, data, editable, onClose, onSaved }: { target: Target; householdId: string; data: CellarData; editable: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [tab, setTab] = useState('details')
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const loadRows = async () => {
    if (!supabase) return
    let query
    if (target.kind === 'wine') query = supabase.from('openings').select('id, opened_at, status, occasion, memory_notes, issue_type').eq('household_id', householdId).eq('wine_id', target.record.id).order('opened_at', { ascending: false })
    else if (target.kind === 'winery') query = supabase.from('winery_visits').select('id, visit_date, notes, favorite, would_visit_again').eq('household_id', householdId).eq('winery_id', target.record.id).order('visit_date', { ascending: false })
    else if (target.kind === 'documents') query = supabase.from('documents').select('id, display_title, document_date, original_filename, storage_path').eq('household_id', householdId).order('created_at', { ascending: false })
    else query = supabase.from('inventory_movements').select('id, movement_type, quantity, occurred_at, reason, purchase_item_id').eq('household_id', householdId).order('occurred_at', { ascending: false }).limit(100)
    const result = await query
    if (result.error) setMessage(result.error.message); else setRows((result.data ?? []) as Row[])
  }

  useEffect(() => { void loadRows() }, [target.kind, target.kind === 'wine' || target.kind === 'winery' ? target.record.id : householdId])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!supabase || !editable) return
    setBusy(true); setMessage(''); const form = new FormData(event.currentTarget)
    try {
      if (target.kind === 'wine') {
        const nonVintage = form.get('non_vintage') === 'on'
        const { error } = await supabase.from('wines').update({ name: String(form.get('name')).trim(), winery_id: optional(form, 'winery_id'), vintage: nonVintage ? null : Number(form.get('vintage')) || null, non_vintage: nonVintage, style: optional(form, 'style'), category: optional(form, 'category'), region: optional(form, 'region'), blend_description: optional(form, 'blend_description'), personal_notes: optional(form, 'notes') }).eq('id', target.record.id).eq('household_id', householdId)
        if (error) throw error
        for (const person of data.people) {
          const { error: preferenceError } = await supabase.from('wine_preferences').upsert({ household_id: householdId, wine_id: target.record.id, person_id: person.id, favorite: form.get(`favorite_${person.id}`) === 'on', buy_again: optional(form, `buy_again_${person.id}`), notes: optional(form, `preference_notes_${person.id}`) }, { onConflict: 'wine_id,person_id' })
          if (preferenceError) throw preferenceError
        }
      } else if (target.kind === 'winery') {
        const { error } = await supabase.from('wineries').update({ name: String(form.get('name')).trim(), region: optional(form, 'region'), state: optional(form, 'state'), country: optional(form, 'country'), city: optional(form, 'city'), website_url: optional(form, 'website_url'), notes: optional(form, 'notes'), favorite: form.get('favorite') === 'on', would_visit_again: optional(form, 'would_visit_again') }).eq('id', target.record.id).eq('household_id', householdId)
        if (error) throw error
      } else if (target.kind === 'storage') {
        const mode = String(form.get('mode'))
        if (mode === 'location') {
          const { error } = await supabase.from('storage_locations').insert({ household_id: householdId, name: String(form.get('name')).trim(), location_type: optional(form, 'location_type') || 'area', description: optional(form, 'description') })
          if (error) throw error
        } else {
          const [purchaseItemId, fromLocationId] = String(form.get('bottle_lot')).split('|')
          const quantity = Number(form.get('quantity'))
          const rpc = mode === 'move' ? supabase.rpc('move_inventory', { p_household_id: householdId, p_purchase_item_id: purchaseItemId, p_from_location_id: fromLocationId, p_to_location_id: String(form.get('to_location_id')), p_quantity: quantity, p_reason: optional(form, 'reason') }) : supabase.rpc('adjust_inventory', { p_household_id: householdId, p_purchase_item_id: purchaseItemId, p_storage_location_id: fromLocationId, p_quantity_delta: mode === 'adjust_in' ? quantity : -quantity, p_reason: String(form.get('reason')).trim() })
          const { error } = await rpc; if (error) throw error
        }
      }
      await onSaved(); setMessage('Saved.'); await loadRows()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save.') } finally { setBusy(false) }
  }

  const uploadPhoto = async (file: File) => {
    if (!supabase || target.kind !== 'wine') return
    setBusy(true); setMessage('')
    const path = `${householdId}/wines/${target.record.id}/${crypto.randomUUID()}-${safeName(file.name)}`
    try {
      const uploaded = await supabase.storage.from('cellar-photos').upload(path, file, { contentType: file.type, upsert: false }); if (uploaded.error) throw uploaded.error
      const saved = await supabase.from('photos').insert({ household_id: householdId, wine_id: target.record.id, storage_path: path, original_filename: file.name, mime_type: file.type, file_size_bytes: file.size, is_hero: false }); if (saved.error) { await supabase.storage.from('cellar-photos').remove([path]); throw saved.error }
      setMessage('Private photo uploaded.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Upload failed.') } finally { setBusy(false) }
  }

  const title = target.kind === 'wine' ? target.record.name : target.kind === 'winery' ? target.record.name : target.kind === 'storage' ? 'Storage' : target.kind === 'documents' ? 'Documents & Receipts' : 'History'
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="workflow-modal workflow-form-modal management-modal" role="dialog" aria-modal="true"><div className="sheet-header"><div><p className="eyebrow burgundy">THE CELLAR</p><h2>{title}</h2></div><button className="icon-close" onClick={onClose}>×</button></div>
    {(target.kind === 'wine' || target.kind === 'winery') && <div className="detail-tabs"><button className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}>Details</button><button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>History</button>{target.kind === 'wine' && <button className={tab === 'media' ? 'active' : ''} onClick={() => setTab('media')}>Photos</button>}</div>}
    {tab === 'details' && target.kind === 'wine' && <form className="workflow-form" onSubmit={submit}><label>Winery<select name="winery_id" defaultValue={target.record.wineryId ?? ''}><option value="">No winery</option>{data.wineries.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label><label>Wine name<input name="name" required defaultValue={target.record.name}/></label><div className="field-grid"><label>Vintage<input name="vintage" type="number" min="1800" defaultValue={target.record.vintage ?? ''}/></label><label className="check-field"><input name="non_vintage" type="checkbox" defaultChecked={target.record.nonVintage}/> Non-vintage</label><label>Style<input name="style" defaultValue={target.record.style ?? ''}/></label><label>Category<input name="category" defaultValue={target.record.category ?? ''}/></label></div><label>Region<input name="region"/></label><label>Varietal or blend<input name="blend_description"/></label><label>Notes<textarea name="notes" rows={3}/></label><h3 className="form-section-title">Personal preferences</h3>{data.people.map(person => <fieldset className="preference-card" key={person.id}><legend>{person.displayName}</legend><label className="check-field"><input name={`favorite_${person.id}`} type="checkbox"/> Favorite</label><label>Buy again<select name={`buy_again_${person.id}`}><option value="">Not set</option><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">No</option></select></label><label>Notes<input name={`preference_notes_${person.id}`}/></label></fieldset>)}{editable && <button className="primary-button" disabled={busy}>Save wine</button>}</form>}
    {tab === 'details' && target.kind === 'winery' && <form className="workflow-form" onSubmit={submit}><label>Name<input name="name" required defaultValue={target.record.name}/></label><div className="field-grid"><label>Region<input name="region" defaultValue={target.record.region ?? ''}/></label><label>State / province<input name="state" defaultValue={target.record.state ?? ''}/></label><label>Country<input name="country" defaultValue={target.record.country ?? ''}/></label><label>City<input name="city"/></label></div><label>Website<input name="website_url" type="url"/></label><label>Visit again<select name="would_visit_again" defaultValue={target.record.wouldVisitAgain ?? ''}><option value="">Not set</option><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">No</option></select></label><label className="check-field"><input name="favorite" type="checkbox" defaultChecked={target.record.favorite}/> Favorite winery</label><label>Notes<textarea name="notes" rows={3}/></label>{editable && <button className="primary-button" disabled={busy}>Save winery</button>}</form>}
    {target.kind === 'storage' && <form className="workflow-form" onSubmit={submit}><label>Action<select name="mode" defaultValue="move"><option value="move">Move bottles</option><option value="adjust_out">Reduce count</option><option value="adjust_in">Increase count</option><option value="location">Add storage area</option></select></label><label>Bottle lot<select name="bottle_lot"><option value="">Choose a lot</option>{data.bottleLots.map(l => <option key={`${l.purchaseItemId}-${l.storageLocationId}`} value={`${l.purchaseItemId}|${l.storageLocationId}`}>{l.wineLabel} · {l.storageLocationName} ({l.quantity})</option>)}</select></label><label>Destination<select name="to_location_id"><option value="">Choose destination</option>{data.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label><label>Quantity<input name="quantity" type="number" min="0.01" step="0.01" defaultValue="1"/></label><label>Reason<input name="reason" placeholder="Required for count adjustments"/></label><hr/><label>New area name<input name="name"/></label><label>Area type<input name="location_type" defaultValue="area"/></label><label>Description<input name="description"/></label>{editable && <button className="primary-button" disabled={busy}>Save storage change</button>}</form>}
    {(tab === 'history' || target.kind === 'history' || target.kind === 'documents') && <div className="history-list">{rows.length ? rows.map(row => <article key={String(row.id)}><strong>{String(row.display_title ?? row.movement_type ?? row.visit_date ?? row.opened_at ?? 'Record')}</strong><p>{String(row.reason ?? row.memory_notes ?? row.notes ?? row.original_filename ?? '')}</p>{row.quantity != null && <small>Quantity {String(row.quantity)}</small>}</article>) : <p className="empty-copy">No records yet.</p>}</div>}
    {tab === 'media' && target.kind === 'wine' && <div className="media-panel"><p>Label and bottle photos stay in the private household bucket and require an authenticated session to view.</p>{editable && <label className="upload-button">Upload private photo<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={busy} onChange={e => e.target.files?.[0] && void uploadPhoto(e.target.files[0])}/></label>}</div>}
    {message && <p className={`form-message ${message === 'Saved.' || message.includes('uploaded') ? '' : 'error'}`}>{message}</p>}
  </section></div>
}

export type { Target as ManagementTarget }
