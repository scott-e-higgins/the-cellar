import { useRef, useState, type FormEvent } from 'react'
import type { CellarData, OpeningRecord } from './lib/cellar-data'
import { supabase } from './lib/supabase'
import { finishSuccessfulAction, type NoticeTone } from './lib/interaction'
import { userError } from './lib/user-error'
import { StarRatingInput } from './StarRating'
const localDate = (value: string) => { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,10) }

export function OpeningReviewForm({ opening, data, householdId, finishing, onCancel, onSaved, onNotice, setBusy }: { opening: OpeningRecord; data: CellarData; householdId: string; finishing: boolean; onCancel: () => void; onSaved: () => Promise<void>; onNotice: (message: string, tone?: NoticeTone) => void; setBusy: (busy: boolean) => void }) {
  const [saving, setSaving] = useState(false), [message, setMessage] = useState('')
  const inFlight = useRef(false), completed = useRef(false)
  const [status, setStatus] = useState(finishing ? 'finished' : opening.status)
  const initialPerson = opening.openedBy === 'Both' ? 'both' : opening.openedByPersonId ?? data.people.find((person) => person.displayName === opening.openedBy)?.id ?? ''
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || inFlight.current || completed.current) return
    const formElement = event.currentTarget, form = new FormData(formElement)
    inFlight.current = true; setSaving(true); setBusy(true); setMessage('')
    const optional = (name: string) => String(form.get(name) ?? '').trim() || null
    const person = optional('opened_by')
    try {
      const result = await supabase.rpc('save_opening_review', {
        p_household_id: householdId, p_opening_id: opening.id,
        p_fields: { status, opened_at: form.get('opened_at') === localDate(opening.openedAt) ? opening.openedAt : new Date(`${form.get('opened_at')}T12:00:00`).toISOString(), finished_at: status === 'finished' ? new Date(`${form.get('finished_at')}T12:00:00`).toISOString() : null, opened_by_person_id: person === 'both' ? null : person, opened_by_both: person === 'both', memory_notes: optional('memory_notes'), enjoyed_with: optional('enjoyed_with'), occasion: optional('occasion'), issue_type: optional('issue_type'), issue_notes: optional('issue_notes') },
        p_reviews: data.people.map((person) => ({ person_id: person.id, rating: optional(`rating_${person.id}`) === null ? null : Number(form.get(`rating_${person.id}`)), buy_again: optional(`buy_again_${person.id}`), tasting_notes: optional(`tasting_notes_${person.id}`) })),
      })
      if (result.error) throw result.error
      completed.current = true
      await finishSuccessfulAction({ form: formElement, refresh: onSaved, finish: onCancel, notice: onNotice, message: 'Opening and tasting notes saved.' })
    } catch (error) { setMessage(userError(error, 'The opening could not be updated. Please try again.')) }
    finally { inFlight.current = false; setSaving(false); setBusy(false) }
  }
  return <form className="workflow-form detail-form edit-record-form" onSubmit={submit} aria-busy={saving}><fieldset className="workflow-fields" disabled={saving || completed.current}>
    <h3>{finishing ? 'Finish Bottle' : 'Tasting notes & rating'}</h3>
    <div className="field-grid"><label>Status<select name="status" value={status} onChange={(event) => setStatus(event.target.value as 'open'|'finished')}><option value="open">Still open</option><option value="finished">Finished</option></select></label>{status === 'finished' && <label>Finished date<input name="finished_at" type="date" required defaultValue={localDate(opening.finishedAt ?? new Date().toISOString())} /></label>}</div>
    {data.people.map((person) => { const review=data.reviews.find((item) => item.openingId===opening.id && item.personId===person.id); return <fieldset className="preference-card" key={person.id}><legend>{person.displayName}</legend><StarRatingInput name={`rating_${person.id}`} defaultValue={review?.rating} /><label>Buy again<select name={`buy_again_${person.id}`} defaultValue={review?.buyAgain ?? ''}><option value="">Not set</option><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">No</option></select></label><label>Tasting notes<textarea name={`tasting_notes_${person.id}`} rows={3} defaultValue={review?.tastingNotes ?? ''} /></label></fieldset> })}
    <label>Memory notes<textarea name="memory_notes" defaultValue={opening.memoryNotes ?? ''} /></label>
    <details className="more-details"><summary>Opening details & corrections</summary><div className="details-fields"><div className="field-grid"><label>Opening date<input name="opened_at" type="date" required defaultValue={localDate(opening.openedAt)} /></label><label>Opened by<select name="opened_by" defaultValue={initialPerson}><option value="">Not specified</option>{data.people.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}<option value="both">Both</option></select></label></div><label>Enjoyed with<input name="enjoyed_with" defaultValue={opening.enjoyedWith ?? ''} /></label><label>Occasion<input name="occasion" defaultValue={opening.occasion ?? ''} /></label><label>Issue<select name="issue_type" defaultValue={opening.issueType ?? ''}><option value="">No issue</option><option value="cork_failed">Cork failed</option><option value="corked">Corked</option><option value="oxidized">Oxidized</option><option value="other">Other</option></select></label><label>Issue notes<textarea name="issue_notes" defaultValue={opening.issueNotes ?? ''} /></label></div></details>
  </fieldset>{message && <p role="alert" className="form-message error">{message}</p>}<div className="form-actions"><button type="button" data-discard className="secondary-button" disabled={saving} onClick={onCancel}>Cancel</button><button className="primary-button" disabled={saving || completed.current}>{saving ? 'Saving…' : 'Save opening'}</button></div></form>
}
