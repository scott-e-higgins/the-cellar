import { FormEvent, useMemo, useState } from 'react'
import type { CellarData, EnrichmentAttempt, EnrichmentSource, OnlineInfoRecord } from './lib/cellar-data'
import { supabase } from './lib/supabase'

type EntityKind = 'wine' | 'winery'
type Navigate = (kind: EntityKind, id: string) => void

const LABELS: Record<string, string> = {
  official_name: 'Official name', producer: 'Producer', vintage: 'Vintage', varietals: 'Grapes', blend_composition: 'Blend', vineyard: 'Vineyard', appellation: 'Appellation', region: 'Region', state_province: 'State / province', country: 'Country', category: 'Category', style: 'Style', sweetness: 'Sweetness', abv: 'Alcohol', residual_sugar: 'Residual sugar', acidity: 'Acidity', ph: 'pH', production_information: 'Production', aging_method: 'Aging', oak_treatment: 'Oak', description: 'Description', tasting_notes: 'Producer tasting notes', food_pairings: 'Food pairings', serving_recommendations: 'Serving', aging_guidance: 'Aging / drinking guidance', production_quantity: 'Production quantity', technical_details: 'Technical details', website_url: 'Website', street_address: 'Address', city: 'City', postal_code: 'Postal code', latitude: 'Latitude', longitude: 'Longitude', phone: 'Phone', email: 'Email', tasting_room_information: 'Tasting room', reservation_information: 'Reservations', hours: 'Hours', social_links: 'Social links', official_details: 'Official details',
}

const LONG_FIELDS = new Set(['description', 'tasting_notes', 'production_information', 'serving_recommendations', 'aging_guidance', 'tasting_room_information', 'reservation_information', 'hours', 'official_details', 'technical_details'])

function readable(value: unknown, field?: string) {
  if (Array.isArray(value)) return value.join(' · ')
  if (field === 'abv' && typeof value === 'number') return `${value}%`
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${LABELS[key] ?? key}: ${String(item)}`).join(' · ')
  return String(value)
}

function titleFor(kind: EntityKind) { return kind === 'wine' ? 'About This Wine' : 'About the Winery' }

function attemptsFor(kind: EntityKind, entityId: string, data: CellarData) {
  return data.enrichmentAttempts.filter((attempt) => kind === 'wine' ? attempt.wineId === entityId : attempt.wineryId === entityId)
}

function sourcesFor(attemptId: string | null, data: CellarData) {
  return attemptId ? data.enrichmentSources.filter((source) => source.attemptId === attemptId) : []
}

function Information({ info, sources }: { info: OnlineInfoRecord; sources: EnrichmentSource[] }) {
  const entries = Object.entries(info.acceptedData).filter(([, value]) => value != null && value !== '' && (!Array.isArray(value) || value.length))
  const description = entries.find(([key]) => key === 'description')
  const facts = entries.filter(([key]) => key !== 'description')
  return <>{description && <p className="online-description">{readable(description[1], description[0])}</p>}<dl className="online-facts">{facts.map(([key, value]) => <div className={LONG_FIELDS.has(key) ? 'wide' : ''} key={key}><dt>{LABELS[key] ?? key.replaceAll('_', ' ')}</dt><dd>{readable(value, key)}</dd></div>)}</dl><SourceList sources={sources} /></>
}

function SourceList({ sources }: { sources: EnrichmentSource[] }) {
  if (!sources.length) return null
  return <details className="source-details"><summary>{sources.length === 1 ? 'Source' : `${sources.length} sources`}</summary><div>{sources.map((source) => <a key={source.id || source.sourceUrl} href={source.sourceUrl} target="_blank" rel="noreferrer"><strong>{source.sourceName}</strong><small>{source.sourceType.replaceAll('_', ' ')} · retrieved {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(source.retrievedAt))}</small></a>)}</div></details>
}

export function RecordEnrichment({ kind, entityId, data, editable, onSaved }: { kind: EntityKind; entityId: string; data: CellarData; editable: boolean; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [editing, setEditing] = useState(false), [dismissed, setDismissed] = useState<string | null>(null)
  const info = (kind === 'wine' ? data.wineOnlineInfo : data.wineryOnlineInfo).find((item) => item.entityId === entityId)
  const attempts = attemptsFor(kind, entityId, data)
  const latest = attempts[0]
  const review = latest?.status === 'ready_for_review' && latest.id !== dismissed ? latest : null
  const sourceAttemptId = info?.acceptedAttemptId ?? review?.id ?? latest?.id ?? null
  const sources = sourcesFor(sourceAttemptId, data)
  const run = async (force = false) => {
    if (!supabase || !editable) return
    setBusy(true); setMessage('')
    const result = await supabase.functions.invoke('enrich-record', { body: { entityKind: kind, entityId, force } })
    if (result.error) setMessage(result.error.message)
    else { await onSaved(); setMessage(result.data?.autoAccepted ? 'Reliable information found and saved.' : result.data?.status === 'no_match' ? 'No reliable match was found.' : 'Information found. Review it below.') }
    setBusy(false)
  }
  const accept = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault(); if (!supabase || !review) return
    setBusy(true); setMessage('')
    let edited: Record<string, unknown> | null = null
    if (event) { const form = new FormData(event.currentTarget); edited = Object.fromEntries(Object.keys(review.proposedData).map((key) => { const original = review.proposedData[key]; const value = String(form.get(key) ?? '').trim(); return [key, Array.isArray(original) ? value.split(';').map((item) => item.trim()).filter(Boolean) : typeof original === 'number' ? Number(value) : value] }).filter(([, value]) => value !== '')) }
    const result = await supabase.rpc('accept_enrichment_attempt', { p_attempt_id: review.id, p_edited_data: edited })
    if (result.error) setMessage(result.error.message); else { await onSaved(); setMessage('Online information accepted.'); setEditing(false) }
    setBusy(false)
  }
  return <section className="detail-section online-info"><div className="online-heading"><div><p className="eyebrow burgundy">OFFICIAL / ONLINE</p><h3>{titleFor(kind)}</h3></div>{info && <span className={`confidence-badge ${info.confidence}`}>{info.confidence}</span>}</div>
    {info ? <Information info={info} sources={sources} /> : !review && <p>{latest?.status === 'no_match' ? 'No reliable online match has been found yet.' : latest?.status === 'failed' ? 'The last search could not be completed.' : 'Add reliable producer and official information without changing your personal notes.'}</p>}
    {review && <div className="enrichment-review"><div className="review-lead"><span className={`confidence-badge ${review.confidence ?? 'low'}`}>{review.confidence ?? 'review'}</span><p>{review.matchExplanation || 'A likely match needs review before it is saved.'}</p></div>{editing ? <form className="enrichment-edit" onSubmit={accept}>{Object.entries(review.proposedData).map(([key, value]) => <label key={key}>{LABELS[key] ?? key.replaceAll('_', ' ')}{LONG_FIELDS.has(key) ? <textarea name={key} defaultValue={readable(value, key)} /> : <input name={key} defaultValue={readable(value, key)} />}{Array.isArray(value) && <small>Separate multiple items with semicolons.</small>}</label>)}<div className="enrichment-actions"><button className="primary-button" disabled={busy}>Save reviewed info</button><button type="button" className="secondary-button" onClick={() => setEditing(false)}>Cancel edit</button></div></form> : <><dl className="online-facts proposed">{Object.entries(review.proposedData).map(([key, value]) => <div className={LONG_FIELDS.has(key) ? 'wide' : ''} key={key}><dt>{LABELS[key] ?? key.replaceAll('_', ' ')}</dt><dd>{readable(value, key)}</dd></div>)}</dl><SourceList sources={sources} /><div className="enrichment-actions"><button className="primary-button" disabled={busy} onClick={() => void accept()}>Accept</button><button className="secondary-button" disabled={busy} onClick={() => setEditing(true)}>Edit</button><button className="secondary-button" disabled={busy} onClick={() => void run(true)}>Try Again</button><button className="text-action" disabled={busy} onClick={() => setDismissed(review.id)}>Cancel</button></div></>}</div>}
    {editable && !review && <button className="secondary-button enrichment-button" disabled={busy} onClick={() => void run(Boolean(info || latest))}>{busy ? 'Searching reliable sources…' : info ? `Refresh ${kind === 'wine' ? 'Wine' : 'Winery'} Info` : `Find ${kind === 'wine' ? 'Wine' : 'Winery'} Info`}</button>}
    {message && <p className="form-message">{message}</p>}
  </section>
}

function latestByEntity(kind: EntityKind, data: CellarData) {
  const map = new Map<string, EnrichmentAttempt>()
  for (const attempt of data.enrichmentAttempts) { const id = kind === 'wine' ? attempt.wineId : attempt.wineryId; if (id && !map.has(id)) map.set(id, attempt) }
  return map
}

function statusFor(kind: EntityKind, id: string, data: CellarData, latest: Map<string, EnrichmentAttempt>) {
  if ((kind === 'wine' ? data.wineOnlineInfo : data.wineryOnlineInfo).some((info) => info.entityId === id)) return 'enriched'
  return latest.get(id)?.status ?? 'not_searched'
}

const STATUS_LABELS: Record<string, string> = { enriched: 'Enriched', ready_for_review: 'Ready for Review', no_match: 'No Match', not_searched: 'Not Yet Searched', failed: 'Failed / Retry', searching: 'Searching', rejected: 'Rejected' }

export function EnrichmentDashboard({ householdId, data, editable, onSaved, onNavigate, kind, setKind, filter, setFilter }: { householdId: string; data: CellarData; editable: boolean; onSaved: () => Promise<void>; onNavigate: Navigate; kind: EntityKind; setKind: (kind: EntityKind) => void; filter: string; setFilter: (filter: string) => void }) {
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState('')
  const latest = useMemo(() => latestByEntity(kind, data), [kind, data])
  const records = kind === 'wine' ? data.wines : data.wineries
  const counts = Object.fromEntries(['enriched', 'ready_for_review', 'no_match', 'not_searched', 'failed'].map((status) => [status, records.filter((record) => statusFor(kind, record.id, data, latest) === status).length]))
  const visible = records.filter((record) => filter === 'all' || statusFor(kind, record.id, data, latest) === filter)
  const runningJob = data.enrichmentJobs.find((job) => job.entityKind === kind && job.status === 'running')
  const runBatch = async () => {
    if (!supabase || !editable) return
    setBusy(true); setProgress('Starting secure background enrichment…')
    const result = await supabase.functions.invoke('enrich-record', { body: { action: 'batch', householdId, entityKind: kind } })
    if (result.error) setProgress(result.error.message)
    else setProgress('Running in the background. You can close the app or let your phone sleep.')
    await onSaved(); setBusy(false)
  }
  return <div className="enrichment-dashboard"><div className="choice-toggle enrichment-kind"><button className={kind === 'wine' ? 'selected' : ''} onClick={() => { setKind('wine'); setFilter('all') }}>Wines</button><button className={kind === 'winery' ? 'selected' : ''} onClick={() => { setKind('winery'); setFilter('all') }}>Wineries</button></div><div className="enrichment-counts">{Object.entries(counts).map(([status, count]) => <button className={filter === status ? 'active' : ''} key={status} onClick={() => setFilter(filter === status ? 'all' : status)}><strong>{count}</strong><span>{STATUS_LABELS[status]}</span></button>)}</div>{runningJob && <div className="batch-job-status"><strong>Enrichment is running in the background</strong><span>{runningJob.processedCount} completed · {runningJob.remainingCount} remaining</span><button className="secondary-button" onClick={() => void onSaved()}>Refresh status</button></div>}{editable && counts.not_searched > 0 && !runningJob && <button className="primary-button full-button" disabled={busy} onClick={() => void runBatch()}>{busy ? 'Starting…' : `Enrich ${counts.not_searched} unsearched ${kind === 'wine' ? 'wines' : 'wineries'}`}</button>}{progress && <p className="batch-progress">{progress}</p>}<div className="enrichment-list">{visible.map((record) => { const status = statusFor(kind, record.id, data, latest); const attempt = latest.get(record.id); return <button key={record.id} onClick={() => onNavigate(kind, record.id)}><span><strong>{record.name}</strong><small>{attempt?.failureReason || attempt?.matchExplanation || STATUS_LABELS[status]}</small></span><span className={`status-dot ${status}`}>{STATUS_LABELS[status]}</span></button> })}</div></div>
}
