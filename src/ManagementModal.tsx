import { createPhotoUpload } from './lib/photo-upload'
import { pushCellarHistory } from './lib/unsaved-changes'
import { FormEvent, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CellarData, GiftRecord, OpeningRecord, PhotoRecord, PurchaseRecord, VisitRecord, WineRecord, WineryRecord } from './lib/cellar-data'
import { supabase } from './lib/supabase'
import { createUniqueId } from './lib/unique-id'
import { StateSelect } from './StateSelect'
import { ClosureSelect } from './ClosureSelect'
import { EnrichmentDashboard, RecordEnrichment } from './Enrichment'
import { userError } from './lib/user-error'
import { guidanceSourceLabel, guidanceStatus } from './lib/aging-guidance'
import { nextRecordContext } from './lib/navigation-context'
import { finishSuccessfulAction, type NoticeTone } from './lib/interaction'
import { LightboxLayer, ModalLayer } from './OverlayLayer'
import { StarRatingDisplay } from './StarRating'
import { PhotoPicker } from './PhotoPicker'
import { bottlesPurchasedForVisit, photosForVisit, tripForVisit, unlinkedPurchasesForVisit, visitCanBeDeleted } from './lib/visits'

export type ManagementTarget =
  | { kind: 'wine'; record: WineRecord; initialTab?: DetailTab; autoAddPhoto?: boolean }
  | { kind: 'winery'; record: WineryRecord; initialTab?: DetailTab; autoAddPhoto?: boolean }
  | { kind: 'opening'; record: OpeningRecord; initialTab?: DetailTab; autoAddPhoto?: boolean }
  | { kind: 'purchase'; record: PurchaseRecord; initialTab?: DetailTab; autoAddPhoto?: boolean }
  | { kind: 'gift'; record: GiftRecord; initialTab?: DetailTab; autoAddPhoto?: boolean }
  | { kind: 'visit'; record: VisitRecord; initialTab?: DetailTab; autoAddPhoto?: boolean }
  | { kind: 'history' | 'favorites' | 'statistics' | 'storage' | 'documents' | 'trips' | 'enrichment' | 'settings' }

type DetailTab = 'details' | 'history' | 'photos'

const optional = (form: FormData, key: string) => String(form.get(key) ?? '').trim() || null
const numberOrNull = (form: FormData, key: string) => { const value = optional(form, key); return value === null ? null : Number(value) }
const safeName = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_')
const date = (value: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value.length === 10 ? `${value}T12:00:00` : value))
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
const targetKey = (target: ManagementTarget) => 'record' in target ? `${target.kind}:${target.record.id}:${target.initialTab ?? 'details'}:${target.autoAddPhoto ? 'add-photo' : ''}` : target.kind

function targetTitle(target: ManagementTarget, data: CellarData) {
  if (target.kind === 'wine' || target.kind === 'winery') return target.record.name
  if (target.kind === 'opening') return data.wines.find((wine) => wine.id === target.record.wineId)?.name ?? 'Bottle opening'
  if (target.kind === 'purchase') return target.record.purchaseLocation ?? 'Purchase'
  if (target.kind === 'gift') return `Gift to ${target.record.giftedTo}`
  if (target.kind === 'visit') return data.wineries.find((winery) => winery.id === target.record.wineryId)?.name ?? 'Winery visit'
  return ({ history: 'History', favorites: 'Favorites', statistics: 'Statistics', storage: 'Storage', documents: 'Documents & Receipts', trips: 'Trips', enrichment: 'Data Enrichment', settings: 'Settings' } as Record<string, string>)[target.kind]
}

function photosFor(target: ManagementTarget, data: CellarData) {
  return data.photos.filter((photo) => {
    if (target.kind === 'wine') return photo.wineId === target.record.id
    if (target.kind === 'winery') return photo.wineryId === target.record.id
    if (target.kind === 'opening') return photo.openingId === target.record.id
    if (target.kind === 'purchase') return photo.purchaseId === target.record.id
    if (target.kind === 'visit') return photo.wineryVisitId === target.record.id
    return false
  })
}

export function ManagementModal({ target, householdId, data, photoUrls, editable, canGoBack, navigationDepth, returnToEnrichment, onBack, onClose, onNavigate, onVisitDeleted, onAddVisit, onAddPurchase, onSaved, onNotice, onOpenBottle }: {
  target: ManagementTarget; householdId: string; data: CellarData; photoUrls: Record<string, string>; editable: boolean; canGoBack: boolean; navigationDepth: number; returnToEnrichment: boolean; onBack: () => void; onClose: () => void; onNavigate: (target: ManagementTarget) => void; onVisitDeleted: (wineryId: string) => void; onAddVisit: (wineryId: string) => void; onAddPurchase: (visit: VisitRecord, tripId: string | null) => void; onSaved: () => Promise<void>; onNotice: (message: string, tone?: NoticeTone) => void; onOpenBottle: (wineId: string) => void
}) {
  const [tab, setTab] = useState<DetailTab>('details')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [viewer, setViewer] = useState<PhotoRecord | null>(null)
  const [photoPrompt, setPhotoPrompt] = useState(false)
  const [enrichmentKind, setEnrichmentKind] = useState<'wine' | 'winery'>(() => sessionStorage.getItem('cellar.enrichment.kind') === 'winery' ? 'winery' : 'wine')
  const [enrichmentFilter, setEnrichmentFilter] = useState(() => sessionStorage.getItem('cellar.enrichment.filter') || 'all')
  const modalRef = useRef<HTMLElement | null>(null)
  const enrichmentScroll = useRef(Number(sessionStorage.getItem('cellar.enrichment.scroll') || 0))
  const contextByTarget = useRef(new Map<string, { scrollTop: number; tab: DetailTab }>())
  const previousDepth = useRef(navigationDepth)
  const currentKey = targetKey(target)
  useEffect(() => { sessionStorage.setItem('cellar.enrichment.kind', enrichmentKind) }, [enrichmentKind])
  useEffect(() => { sessionStorage.setItem('cellar.enrichment.filter', enrichmentFilter) }, [enrichmentFilter])
  useLayoutEffect(() => {
    const returning = navigationDepth < previousDepth.current
    const defaultTab = 'record' in target ? target.initialTab ?? 'details' : 'details'
    const nextContext = nextRecordContext({ previousDepth: previousDepth.current, nextDepth: navigationDepth, saved: contextByTarget.current.get(currentKey), defaultTab })
    const nextTab = nextContext.tab
    setTab(nextTab); setEditing(false); setMessage(''); setViewer(null); setPhotoPrompt('record' in target && Boolean(target.autoAddPhoto))
    const nextScroll = returning && target.kind === 'enrichment' && !contextByTarget.current.has(currentKey) ? enrichmentScroll.current : nextContext.scrollTop
    requestAnimationFrame(() => modalRef.current?.scrollTo({ top: nextScroll }))
    previousDepth.current = navigationDepth
  }, [currentKey, navigationDepth])
  useEffect(() => {
    const closeViewer = () => setViewer(null)
    window.addEventListener('popstate', closeViewer)
    return () => window.removeEventListener('popstate', closeViewer)
  }, [])
  const viewPhoto = (photo: PhotoRecord) => {
    setViewer(photo)
    pushCellarHistory({ ...window.history.state, cellarLightbox: true })
  }
  const closeViewer = () => window.history.back()
  const recordTarget = ['wine', 'winery', 'opening', 'purchase', 'gift', 'visit'].includes(target.kind)
  const tabbedRecordTarget = target.kind !== 'gift'
  const relatedPhotos = photosFor(target, data)
  const hero = relatedPhotos.find((photo) => photo.isHero) ?? relatedPhotos[0]
  const title = targetTitle(target, data)
  const usesBack = recordTarget || canGoBack
  const rememberContext = () => contextByTarget.current.set(currentKey, { scrollTop: modalRef.current?.scrollTop ?? 0, tab })
  const navigateFromCurrent = (next: ManagementTarget) => { rememberContext(); onNavigate(next) }
  const backFromCurrent = () => { rememberContext(); onBack() }
  return <>
    <ModalLayer layer="management" onDismiss={onClose} dismissible={!busy} surfaceClassName="workflow-modal workflow-form-modal management-modal" surfaceRef={modalRef} ariaLabel={title} onSurfaceScroll={(event) => { contextByTarget.current.set(currentKey, { scrollTop: event.currentTarget.scrollTop, tab }); if (target.kind === 'enrichment') { enrichmentScroll.current = event.currentTarget.scrollTop; sessionStorage.setItem('cellar.enrichment.scroll', String(event.currentTarget.scrollTop)) } }}>
      <div className="sheet-header detail-header">
        <button className="icon-close" onClick={usesBack ? backFromCurrent : onClose} aria-label={usesBack ? 'Back' : 'Close'}>{usesBack ? '‹' : '×'}</button>
        <div><p className="eyebrow burgundy">THE CELLAR</p><h2>{title}</h2></div>
        {recordTarget && editable && (target.kind === 'wine' || target.kind === 'winery' || target.kind === 'visit') ? <button className="text-button" onClick={() => setEditing((value) => !value)}>{editing ? 'Cancel' : target.kind === 'visit' ? 'Edit Visit' : 'Edit'}</button> : <span className="header-spacer" />}
      </div>
      {recordTarget && tabbedRecordTarget && <div className="detail-tabs"><button className={tab === 'details' ? 'active' : ''} onClick={() => { setTab('details'); contextByTarget.current.set(currentKey, { scrollTop: 0, tab: 'details' }); modalRef.current?.scrollTo({ top: 0 }) }}>Details</button><button className={tab === 'history' ? 'active' : ''} onClick={() => { setTab('history'); contextByTarget.current.set(currentKey, { scrollTop: 0, tab: 'history' }); modalRef.current?.scrollTo({ top: 0 }) }}>History</button><button className={tab === 'photos' ? 'active' : ''} onClick={() => { setTab('photos'); contextByTarget.current.set(currentKey, { scrollTop: 0, tab: 'photos' }); modalRef.current?.scrollTo({ top: 0 }) }}>Photos</button></div>}
      {recordTarget && tab === 'details' && <>
        <RecordHero target={target} data={data} hasPhoto={Boolean(hero)} url={hero ? photoUrls[hero.id] : undefined} editable={editable} onView={() => hero && viewPhoto(hero)} onAdd={() => { setPhotoPrompt(true); setTab('photos') }} />
        {target.kind === 'wine' && <WineDetails wine={target.record} data={data} editing={editing} setEditing={setEditing} editable={editable} busy={busy} setBusy={setBusy} setMessage={setMessage} householdId={householdId} onSaved={onSaved} onNotice={onNotice} onNavigate={navigateFromCurrent} onOpenBottle={onOpenBottle} onEnrichmentAccepted={returnToEnrichment ? backFromCurrent : undefined} />}
        {target.kind === 'winery' && <WineryDetails winery={target.record} data={data} photoUrls={photoUrls} editing={editing} setEditing={setEditing} editable={editable} busy={busy} setBusy={setBusy} setMessage={setMessage} householdId={householdId} onSaved={onSaved} onNotice={onNotice} onNavigate={navigateFromCurrent} onAddVisit={onAddVisit} onEnrichmentAccepted={returnToEnrichment ? backFromCurrent : undefined} />}
        {target.kind === 'opening' && <OpeningDetails opening={target.record} data={data} onNavigate={navigateFromCurrent} />}
        {target.kind === 'purchase' && <PurchaseDetails purchase={target.record} data={data} onNavigate={navigateFromCurrent} />}
        {target.kind === 'gift' && <GiftDetails gift={target.record} data={data} onNavigate={navigateFromCurrent} />}
        {target.kind === 'visit' && <VisitDetails visit={target.record} data={data} photoUrls={photoUrls} editing={editing} setEditing={setEditing} editable={editable} busy={busy} setBusy={setBusy} setMessage={setMessage} householdId={householdId} onSaved={onSaved} onNotice={onNotice} onNavigate={navigateFromCurrent} onDeleted={onVisitDeleted} onAddPurchase={onAddPurchase} />}
      </>}
      {recordTarget && tabbedRecordTarget && tab === 'history' && <History target={target} data={data} onNavigate={navigateFromCurrent} />}
      {recordTarget && tabbedRecordTarget && tab === 'photos' && <PhotoPanel target={target} householdId={householdId} photos={relatedPhotos} urls={photoUrls} editable={editable} busy={busy} autoAdd={photoPrompt} onPrompted={() => setPhotoPrompt(false)} setBusy={setBusy} setMessage={setMessage} onSaved={onSaved} onNotice={onNotice} onView={viewPhoto} />}
      {target.kind === 'history' && <History target={target} data={data} onNavigate={navigateFromCurrent} />}
      {target.kind === 'favorites' && <Favorites data={data} onNavigate={navigateFromCurrent} />}
      {target.kind === 'statistics' && <Statistics data={data} />}
      {target.kind === 'storage' && <Storage data={data} householdId={householdId} editable={editable} onSaved={onSaved} onNotice={onNotice} />}
      {target.kind === 'documents' && <Documents householdId={householdId} data={data} editable={editable} onSaved={onSaved} onNotice={onNotice} onNavigate={navigateFromCurrent} />}
      {target.kind === 'enrichment' && <EnrichmentDashboard householdId={householdId} data={data} editable={editable} onSaved={onSaved} kind={enrichmentKind} setKind={setEnrichmentKind} filter={enrichmentFilter} setFilter={setEnrichmentFilter} onNavigate={(kind, id) => { enrichmentScroll.current = modalRef.current?.scrollTop ?? 0; if (kind === 'wine') { const wine = data.wines.find((item) => item.id === id); if (wine) navigateFromCurrent({ kind: 'wine', record: wine }) } else { const winery = data.wineries.find((item) => item.id === id); if (winery) navigateFromCurrent({ kind: 'winery', record: winery }) } }} />}
      {target.kind === 'trips' && <Empty title="Trips will appear when they are genuinely linked" text="The Travel Journal remains independent. This area will stay quiet until controlled two-way trip links are implemented." />}
      {target.kind === 'settings' && <Empty title="Private household collection" text="Authentication, member roles, private photos and documents, installable PWA behavior, and import guardrails are active." />}
      {message && <p className={/saved|uploaded|updated|deleted|accepted/i.test(message) ? 'form-message success' : 'form-message error'} role="status">{message}</p>}
    </ModalLayer>
    {viewer && <PhotoViewer photo={viewer} photos={relatedPhotos} urls={photoUrls} onSelect={setViewer} onClose={closeViewer} />}
  </>
}

function RecordHero({ target, data, hasPhoto, url, editable, onView, onAdd }: { target: ManagementTarget; data: CellarData; hasPhoto: boolean; url?: string; editable: boolean; onView: () => void; onAdd: () => void }) {
  if (!['wine', 'winery', 'opening', 'purchase', 'gift', 'visit'].includes(target.kind)) return null
  let meta = '', fallback = '🍷'
  let summary: ReactNode = ''
  if (target.kind === 'wine') { meta = `${target.record.wineryName ?? 'Independent wine'} · ${target.record.nonVintage ? 'NV' : target.record.vintage ?? 'Vintage not set'}`; summary = <span className="record-rating-summary"><span>{target.record.availableQuantity} available</span>{target.record.averageRating !== null && <><span aria-hidden="true"> · </span><StarRatingDisplay value={target.record.averageRating} compact showValue /></>}</span> }
  if (target.kind === 'winery') { fallback = '♜'; meta = [target.record.city, target.record.state, target.record.country].filter(Boolean).join(', ') || 'Location not set'; summary = `${target.record.wineCount} wines · ${target.record.visitCount} visits` }
  if (target.kind === 'opening') { const wine = data.wines.find((item) => item.id === target.record.wineId); meta = target.record.status === 'open' ? 'Bottle opened' : 'Bottle enjoyed'; summary = `${date(target.record.openedAt)}${target.record.openedBy ? ` · ${target.record.openedBy}` : ''}`; fallback = wine?.category?.toLowerCase().includes('red') ? '🍷' : '🥂' }
  if (target.kind === 'purchase') { fallback = target.record.acquisitionType === 'gift' ? '🎁' : '🧾'; meta = target.record.acquisitionType === 'gift' ? `Gift${target.record.giftFrom ? ` from ${target.record.giftFrom}` : ''}` : target.record.purchaseLocation ?? 'Purchase'; summary = [target.record.acquisitionDate ? date(target.record.acquisitionDate) : null, target.record.totalCost == null ? null : money(target.record.totalCost)].filter(Boolean).join(' · ') }
  if (target.kind === 'gift') { fallback = '🎁'; meta = `Gifted to ${target.record.giftedTo}`; summary = date(target.record.giftedOn) }
  if (target.kind === 'visit') { fallback = '♜'; meta = 'Winery visit'; summary = date(target.record.visitDate) }
  return <section className="record-hero"><button data-keep-draft={hasPhoto || undefined} className={`record-hero-media ${hasPhoto ? 'has-photo' : editable ? 'can-add-photo' : ''}`} onClick={hasPhoto ? onView : editable ? onAdd : undefined} disabled={!hasPhoto && !editable} aria-label={hasPhoto ? 'View photo' : editable ? 'Add photo' : undefined}>{url ? <img src={url} alt="" /> : hasPhoto ? <small>Loading photo…</small> : <span>{fallback}</span>}</button><p>{meta}</p><strong>{summary}</strong></section>
}

function EditSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="edit-form-section"><h3>{title}</h3><div className="edit-section-fields">{children}</div></section>
}

function WineDetails({ wine, data, editing, setEditing, editable, busy, setBusy, setMessage, householdId, onSaved, onNotice, onNavigate, onOpenBottle, onEnrichmentAccepted }: { wine: WineRecord; data: CellarData; editing: boolean; setEditing: (value: boolean) => void; editable: boolean; busy: boolean; setBusy: (value: boolean) => void; setMessage: (value: string) => void; householdId: string; onSaved: () => Promise<void>; onNotice: (message: string, tone?: NoticeTone) => void; onNavigate: (target: ManagementTarget) => void; onOpenBottle: (wineId: string) => void; onEnrichmentAccepted?: () => void }) {
  const preferences = useMemo(() => Object.fromEntries(data.preferences.filter((preference) => preference.wineId === wine.id).map((preference) => [preference.personId, preference])), [data.preferences, wine.id])
  const purchases = data.purchaseItems.filter((item) => item.wineId === wine.id).map((item) => ({ item, purchase: data.purchases.find((purchase) => purchase.id === item.purchaseId) })).filter((entry) => entry.purchase)
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!supabase || !editable) return
    setBusy(true); setMessage(''); const formElement = event.currentTarget; const form = new FormData(formElement)
    try {
      const nonVintage = form.get('non_vintage') === 'on'
      const result = await supabase.from('wines').update({ winery_id: optional(form, 'winery_id'), name: String(form.get('name')).trim(), vintage: nonVintage ? null : numberOrNull(form, 'vintage'), non_vintage: nonVintage, blend_description: optional(form, 'blend_description'), style: optional(form, 'style'), category: optional(form, 'category'), sweetness: optional(form, 'sweetness'), country: optional(form, 'country'), state: optional(form, 'state'), vineyard: optional(form, 'vineyard'), closure: optional(form, 'closure'), official_winery_notes: optional(form, 'official_winery_notes'), personal_notes: optional(form, 'personal_notes'), favorite: form.get('favorite') === 'on' }).eq('household_id', householdId).eq('id', wine.id)
      if (result.error) throw result.error
      for (const person of data.people) { const preference = await supabase.from('wine_preferences').upsert({ household_id: householdId, wine_id: wine.id, person_id: person.id, favorite: form.get(`favorite_${person.id}`) === 'on', buy_again: optional(form, `buy_again_${person.id}`), notes: optional(form, `notes_${person.id}`) }, { onConflict: 'wine_id,person_id' }); if (preference.error) throw preference.error }
      await finishSuccessfulAction({ form: formElement, refresh: onSaved, finish: () => setEditing(false), notice: onNotice, message: 'Wine saved.' })
    } catch (error) { setMessage(userError(error, 'The wine could not be saved. Please try again.')) } finally { setBusy(false) }
  }
  if (editing) return <form className="workflow-form detail-form edit-record-form" onSubmit={save}><fieldset className="workflow-fields" disabled={busy}>
    <EditSection title="Identity">
      <label>Winery<select name="winery_id" defaultValue={wine.wineryId ?? ''}><option value="">No winery</option>{data.wineries.map((winery) => <option key={winery.id} value={winery.id}>{winery.name}</option>)}</select></label>
      <label>Wine name<input name="name" required defaultValue={wine.name} /></label>
      <div className="field-grid"><label>Vintage<input name="vintage" type="number" min="1800" defaultValue={wine.vintage ?? ''} /></label><label className="check-field paired-check-field"><input name="non_vintage" type="checkbox" defaultChecked={wine.nonVintage} /> Non-vintage</label></div>
    </EditSection>
    <EditSection title="Wine profile">
      <div className="field-grid"><label>Category<input name="category" defaultValue={wine.category ?? ''} /></label><label>Style<input name="style" defaultValue={wine.style ?? ''} /></label><label>Sweetness<input name="sweetness" defaultValue={wine.sweetness ?? ''} /></label><ClosureSelect defaultValue={wine.closure} /></div>
      <label>Varietal or blend<input name="blend_description" defaultValue={wine.blendDescription ?? ''} /></label>
      <label>Vineyard<input name="vineyard" defaultValue={wine.vineyard ?? ''} /></label>
    </EditSection>
    <EditSection title="Origin">
      <div className="field-grid"><label>Country<input name="country" defaultValue={wine.country ?? ''} /></label><StateSelect defaultValue={wine.state ?? ''} /></div>
    </EditSection>
    <EditSection title="Recorded information">
      <label>Official winery notes<textarea name="official_winery_notes" rows={3} defaultValue={wine.officialWineryNotes ?? ''} /></label>
      <label>Our notes<textarea name="personal_notes" rows={3} defaultValue={wine.personalNotes ?? ''} /></label>
      <label className="check-field"><input name="favorite" type="checkbox" defaultChecked={wine.favorite} /> Household favorite</label>
    </EditSection>
    <EditSection title="Household preferences">
      {data.people.map((person) => { const preference = preferences[person.id]; return <fieldset className="preference-card" key={person.id}><legend>{person.displayName}</legend><label className="check-field"><input name={`favorite_${person.id}`} type="checkbox" defaultChecked={preference?.favorite} /> Favorite</label><label>Buy again<select name={`buy_again_${person.id}`} defaultValue={preference?.buyAgain ?? ''}><option value="">Not set</option><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">No</option></select></label><label>Notes<input name={`notes_${person.id}`} defaultValue={preference?.notes ?? ''} /></label></fieldset> })}
    </EditSection>
    <div className="form-actions edit-form-actions"><button type="button" data-discard className="secondary-button" onClick={() => setEditing(false)} disabled={busy}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save wine'}</button></div>
  </fieldset></form>
  return <div className="detail-content">{wine.availableQuantity > 0 && editable && <button className="primary-button full-button" onClick={() => onOpenBottle(wine.id)}>Open or gift a bottle</button>}<section className="detail-section"><h3>At a glance</h3><dl className="fact-grid"><Fact label="Vintage" value={wine.nonVintage ? 'NV' : wine.vintage?.toString()} /><Fact label="Type" value={wine.category ?? wine.style} /><Fact label="Location" value={wine.storageNames.join(', ') || 'Rack'} /><Fact label="Closure" value={wine.closure} /></dl></section><AgingSection wine={wine} data={data} editable={editable} householdId={householdId} onSaved={onSaved} onNotice={onNotice} setMessage={setMessage} />{wine.wineryId && <section className="detail-section"><h3>Winery</h3><RecordLink title={wine.wineryName ?? 'Winery'} subtitle={[wine.state, wine.country].filter(Boolean).join(', ')} onClick={() => { const winery = data.wineries.find((item) => item.id === wine.wineryId); if (winery) onNavigate({ kind: 'winery', record: winery }) }} /></section>}<RecordEnrichment kind="wine" entityId={wine.id} data={data} editable={editable} onSaved={onSaved} onAccepted={onEnrichmentAccepted} />{(wine.blendDescription || wine.vineyard || wine.officialWineryNotes) && <section className="detail-section"><h3>Cellar Details</h3>{wine.blendDescription && <p>{wine.blendDescription}</p>}{wine.vineyard && <p><strong>Vineyard:</strong> {wine.vineyard}</p>}{wine.officialWineryNotes && <details className="read-more"><summary>Previously recorded winery notes</summary><p>{wine.officialWineryNotes}</p></details>}</section>}{wine.personalNotes && <section className="detail-section"><p className="eyebrow burgundy">PERSONAL</p><h3>Our Notes</h3><p>{wine.personalNotes}</p></section>}{purchases.length > 0 && <section className="detail-section"><h3>How it came to us</h3><div className="record-list">{purchases.map(({ item, purchase }) => <RecordLink key={item.id} title={`${item.quantity} bottle${item.quantity === 1 ? '' : 's'} · ${purchase!.acquisitionType === 'gift' ? 'Gift' : 'Purchased'}`} subtitle={[purchase!.acquisitionDate ? date(purchase!.acquisitionDate) : null, purchase!.acquisitionType === 'gift' ? purchase!.giftFrom : purchase!.purchaseLocation, item.totalCost == null ? null : money(item.totalCost)].filter(Boolean).join(' · ')} onClick={() => onNavigate({ kind: 'purchase', record: purchase! })} />)}</div></section>}</div>
}

function AgingSection({ wine, data, editable, householdId, onSaved, onNotice, setMessage }: { wine: WineRecord; data: CellarData; editable: boolean; householdId: string; onSaved: () => Promise<void>; onNotice: (message: string, tone?: NoticeTone) => void; setMessage: (value: string) => void }) {
  const guidance = data.drinkingGuidance.find((item) => item.wineId === wine.id)
  const agingBottles = data.bottles.filter((bottle) => bottle.wineId === wine.id && bottle.status === 'active' && bottle.isAging)
  const [aging, setAging] = useState(agingBottles.length > 0)
  const [quantity, setQuantity] = useState(Math.max(1, agingBottles.length))
  const [overrideYear, setOverrideYear] = useState<number | ''>(agingBottles.find((bottle) => bottle.userHoldUntilYear)?.userHoldUntilYear ?? '')
  const [saving, setSaving] = useState(false)
  if (!guidance) return <section className="detail-section aging-section"><h3>When to Enjoy</h3><p className="empty-copy compact">There is not enough reliable information to estimate a drinking window for this wine yet.</p></section>
  const status = guidanceStatus(guidance)
  const window = guidance.drinkWindowStartYear || guidance.drinkWindowEndYear ? `${guidance.drinkWindowStartYear ?? 'Now'}–${guidance.drinkWindowEndYear ?? 'Open'}` : 'Not established'
  const saveAging = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!supabase || !editable) return
    setSaving(true); setMessage('')
    try {
      const result = await supabase.rpc('set_wine_aging_quantity', { p_household_id: householdId, p_wine_id: wine.id, p_aging_count: aging ? quantity : 0, p_user_hold_override_year: aging && overrideYear !== '' ? overrideYear : null })
      if (result.error) throw result.error
      await finishSuccessfulAction({ refresh: onSaved, notice: onNotice, message: aging ? `${quantity} bottle${quantity === 1 ? '' : 's'} set aside for aging.` : 'Aging bottles updated.' })
    } catch (error) { setMessage(userError(error, 'The aging selection could not be saved. Please try again.')) } finally { setSaving(false) }
  }
  return <section className="detail-section aging-section"><div className="aging-heading"><div><h3>When to Enjoy</h3><p>{wine.availableQuantity} on hand · {agingBottles.length} Aging</p></div>{status && <span className={`guidance-status ${status.toLowerCase().replace(' ', '-')}`}>{status}</span>}</div><dl className="fact-grid"><Fact label="Drinking window" value={window} /><Fact label="Suggested hold" value={guidance.suggestedHoldUntilYear ? `Until ${guidance.suggestedHoldUntilYear}` : 'No hold suggested'} /></dl>{guidance.rationale && <p className="guidance-rationale">{guidance.rationale}</p>}<p className="guidance-source">{guidanceSourceLabel(guidance.source)} · {guidance.confidence} confidence{guidance.sourceUrl && <>{' · '}<a href={guidance.sourceUrl} target="_blank" rel="noreferrer">Source ↗</a></>}</p>{editable && wine.availableQuantity > 0 && <form className="aging-control" onSubmit={saveAging}><label className="check-field"><input type="checkbox" checked={aging} onChange={(event) => setAging(event.target.checked)} /> Aging</label>{aging && <><label>How many bottles should be set aside?<input type="number" min="1" max={wine.availableQuantity} step="1" value={quantity} onChange={(event) => setQuantity(Math.max(1, Math.min(wine.availableQuantity, Number(event.target.value))))} /></label><details><summary>Change hold year</summary><label>Hold until<input type="number" min={new Date().getFullYear()} max="2200" placeholder={String(guidance.suggestedHoldUntilYear ?? '')} value={overrideYear} onChange={(event) => setOverrideYear(event.target.value ? Number(event.target.value) : '')} /></label><small>Your hold year overrides the suggestion for the selected bottles.</small></details></>}<button className="secondary-button" disabled={saving}>{saving ? 'Saving…' : 'Save Aging selection'}</button></form>}</section>
}

function WineryDetails({ winery, data, photoUrls, editing, setEditing, editable, busy, setBusy, setMessage, householdId, onSaved, onNotice, onNavigate, onAddVisit, onEnrichmentAccepted }: { winery: WineryRecord; data: CellarData; photoUrls: Record<string,string>; editing: boolean; setEditing: (value: boolean) => void; editable: boolean; busy: boolean; setBusy: (value: boolean) => void; setMessage: (value: string) => void; householdId: string; onSaved: () => Promise<void>; onNotice: (message: string, tone?: NoticeTone) => void; onNavigate: (target: ManagementTarget) => void; onAddVisit: (wineryId: string) => void; onEnrichmentAccepted?: () => void }) {
  const save = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!supabase || !editable) return; setBusy(true); setMessage(''); const formElement = event.currentTarget; const form = new FormData(formElement); try { const result = await supabase.from('wineries').update({ name: String(form.get('name')).trim(), country: optional(form, 'country'), state: optional(form, 'state'), region: optional(form, 'region'), city: optional(form, 'city'), address: optional(form, 'address'), website_url: optional(form, 'website_url'), contact_phone: optional(form, 'contact_phone'), contact_email: optional(form, 'contact_email'), notes: optional(form, 'notes'), favorite: form.get('favorite') === 'on', would_visit_again: optional(form, 'would_visit_again') }).eq('household_id', householdId).eq('id', winery.id); if (result.error) throw result.error; await finishSuccessfulAction({ form: formElement, refresh: onSaved, finish: () => setEditing(false), notice: onNotice, message: 'Winery saved.' }) } catch (error) { setMessage(userError(error, 'The winery could not be saved. Please try again.')) } finally { setBusy(false) } }
  if (editing) return <form className="workflow-form detail-form edit-record-form" onSubmit={save}><fieldset className="workflow-fields" disabled={busy}>
    <EditSection title="Identity">
      <label>Name<input name="name" required defaultValue={winery.name} /></label>
    </EditSection>
    <EditSection title="Location">
      <label>Street address<input name="address" defaultValue={winery.address ?? ''} /></label>
      <div className="field-grid"><label>City<input name="city" defaultValue={winery.city ?? ''} /></label><StateSelect defaultValue={winery.state ?? ''} /></div>
      <div className="field-grid"><label>Region<input name="region" defaultValue={winery.region ?? ''} /></label><label>Country<input name="country" defaultValue={winery.country ?? ''} /></label></div>
    </EditSection>
    <EditSection title="Contact">
      <label>Website<input name="website_url" type="url" defaultValue={winery.websiteUrl ?? ''} /></label>
      <div className="field-grid"><label>Phone<input name="contact_phone" type="tel" defaultValue={winery.contactPhone ?? ''} /></label><label>Email<input name="contact_email" type="email" defaultValue={winery.contactEmail ?? ''} /></label></div>
    </EditSection>
    <EditSection title="Our information">
      <label>Would visit again<select name="would_visit_again" defaultValue={winery.wouldVisitAgain ?? ''}><option value="">Not set</option><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">No</option></select></label>
      <label className="check-field"><input name="favorite" type="checkbox" defaultChecked={winery.favorite} /> Favorite winery</label>
      <label>Notes<textarea name="notes" rows={4} defaultValue={winery.notes ?? ''} /></label>
    </EditSection>
    <div className="form-actions edit-form-actions"><button type="button" data-discard className="secondary-button" onClick={() => setEditing(false)} disabled={busy}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save winery'}</button></div>
  </fieldset></form>
  const wines = data.wines.filter((wine) => wine.wineryId === winery.id), visits = data.visits.filter((visit) => visit.wineryId === winery.id)
  return <div className="detail-content">
    <RecordEnrichment kind="winery" entityId={winery.id} data={data} editable={editable} onSaved={onSaved} onAccepted={onEnrichmentAccepted} />
    {(winery.notes || winery.websiteUrl) && <section className="detail-section"><p className="eyebrow burgundy">PERSONAL / RECORDED</p><h3>Our Winery Notes</h3>{winery.notes && <p>{winery.notes}</p>}{winery.websiteUrl && <a className="inline-link" href={winery.websiteUrl} target="_blank" rel="noreferrer">Recorded website ↗</a>}</section>}
    <section className="detail-section"><h3>Wines from here</h3>{wines.length ? <div className="record-list">{wines.map((wine) => <RecordLink key={wine.id} title={wine.name} subtitle={wineLinkSubtitle(wine, `${wine.availableQuantity} available`)} onClick={() => onNavigate({ kind: 'wine', record: wine })} />)}</div> : <p className="empty-copy compact">No wines linked yet.</p>}</section>
    <section className="detail-section"><div className="section-action-heading"><h3>Visits</h3>{editable && <button className="secondary-button compact-button" onClick={() => onAddVisit(winery.id)}>Add Visit</button>}</div>{visits.length ? <div className="visit-card-list">{visits.map((visit) => { const photos = photosForVisit(data, visit.id), hero = photos.find((photo) => photo.isHero) ?? photos[0], trip = tripForVisit(data, visit.id), bottleCount = bottlesPurchasedForVisit(data, visit.id); return <button className="visit-card" key={visit.id} onClick={() => onNavigate({ kind: 'visit', record: visit })}>{hero && <span className="visit-card-photo">{photoUrls[hero.id] ? <img src={photoUrls[hero.id]} alt="" /> : <small>Loading…</small>}</span>}<span className="visit-card-copy"><strong>{date(visit.visitDate)}</strong>{trip && <small>{trip.name}</small>}{visit.notes && <p>{visit.notes}</p>}<small>{bottleCount} {bottleCount === 1 ? 'bottle' : 'bottles'} · {photos.length} {photos.length === 1 ? 'photo' : 'photos'}</small></span><span aria-hidden="true">›</span></button> })}</div> : <p className="empty-copy compact">No visits recorded yet.</p>}</section>
  </div>
}

function OpeningDetails({ opening, data, onNavigate }: { opening: OpeningRecord; data: CellarData; onNavigate: (target: ManagementTarget) => void }) {
  const wine = data.wines.find((item) => item.id === opening.wineId), reviews = data.reviews.filter((review) => review.openingId === opening.id)
  return <div className="detail-content">{wine && <section className="detail-section"><h3>Wine</h3><RecordLink title={wine.name} subtitle={`${wine.wineryName ?? 'Winery not set'} · ${wine.nonVintage ? 'NV' : wine.vintage ?? 'Vintage not set'}`} onClick={() => onNavigate({ kind: 'wine', record: wine })} /></section>}<section className="detail-section"><h3>The memory</h3><dl className="fact-grid"><Fact label="Opened" value={date(opening.openedAt)} /><Fact label="Opened by" value={opening.openedBy ?? 'Not specified'} /><Fact label="Status" value={opening.status === 'open' ? 'Still open' : 'Finished'} /><Fact label="Occasion" value={opening.occasion} /></dl>{opening.enjoyedWith && <p><strong>Enjoyed with:</strong> {opening.enjoyedWith}</p>}{opening.memoryNotes && <p>{opening.memoryNotes}</p>}{opening.issueType && <p className="issue-note"><strong>Issue:</strong> {opening.issueType.replace('_', ' ')}{opening.issueNotes ? ` · ${opening.issueNotes}` : ''}</p>}</section>{reviews.length > 0 && <section className="detail-section"><h3>What we thought</h3><div className="review-grid">{reviews.map((review) => { const person = data.people.find((item) => item.id === review.personId); return <article key={review.id}><strong>{person?.displayName ?? 'Household member'}</strong><div className="review-rating">{review.rating ? <StarRatingDisplay value={review.rating} showValue /> : <span>Not rated</span>}</div>{review.buyAgain && <p>Buy again: {review.buyAgain}</p>}{review.tastingNotes && <p>{review.tastingNotes}</p>}</article> })}</div></section>}</div>
}

function PurchaseDetails({ purchase, data, onNavigate }: { purchase: PurchaseRecord; data: CellarData; onNavigate: (target: ManagementTarget) => void }) {
  const items = data.purchaseItems.filter((item) => item.purchaseId === purchase.id), visit = purchase.wineryVisitId ? data.visits.find((item) => item.id === purchase.wineryVisitId) : null
  const receivedAsGift = purchase.acquisitionType === 'gift'
  return <div className="detail-content"><section className="detail-section"><h3>{receivedAsGift ? 'Gift received' : 'Purchase'}</h3><dl className="fact-grid"><Fact label={receivedAsGift ? 'Date received' : 'Date'} value={purchase.acquisitionDate ? date(purchase.acquisitionDate) : undefined} />{receivedAsGift ? <Fact label="Gift from" value={purchase.giftFrom} /> : <><Fact label="Total" value={purchase.totalCost == null ? undefined : money(purchase.totalCost)} /><Fact label="Purchased by" value={purchase.purchasedBy} /><Fact label="Selected by" value={purchase.selectedBy} /></>}</dl>{purchase.notes && <p>{purchase.notes}</p>}</section><section className="detail-section"><h3>{receivedAsGift ? 'Wines received' : 'Wines purchased'}</h3><div className="record-list">{items.map((item) => { const wine = data.wines.find((entry) => entry.id === item.wineId); return wine ? <RecordLink key={item.id} title={wine.name} subtitle={`${item.quantity} bottle${item.quantity === 1 ? '' : 's'}${item.totalCost == null ? '' : ` · ${money(item.totalCost)}`}`} onClick={() => onNavigate({ kind: 'wine', record: wine })} /> : null })}</div></section>{visit && <section className="detail-section"><h3>Related visit</h3><RecordLink title={date(visit.visitDate)} subtitle="Winery visit" onClick={() => onNavigate({ kind: 'visit', record: visit })} /></section>}</div>
}

function GiftDetails({ gift, data, onNavigate }: { gift: GiftRecord; data: CellarData; onNavigate: (target: ManagementTarget) => void }) {
  const wine = data.wines.find((item) => item.id === gift.wineId)
  return <div className="detail-content">{wine && <section className="detail-section"><h3>Wine</h3><RecordLink title={wine.name} subtitle={`${wine.wineryName ?? 'Winery not set'} · ${wine.nonVintage ? 'NV' : wine.vintage ?? 'Vintage not set'}`} onClick={() => onNavigate({ kind: 'wine', record: wine })} /></section>}<section className="detail-section"><h3>Gift</h3><dl className="fact-grid"><Fact label="Gifted to" value={gift.giftedTo} /><Fact label="Date" value={date(gift.giftedOn)} /></dl>{gift.occasionNote && <p>{gift.occasionNote}</p>}</section></div>
}

function VisitDetails({ visit, data, photoUrls, editing, setEditing, editable, busy, setBusy, setMessage, householdId, onSaved, onNotice, onNavigate, onDeleted, onAddPurchase }: { visit: VisitRecord; data: CellarData; photoUrls: Record<string,string>; editing: boolean; setEditing: (value: boolean) => void; editable: boolean; busy: boolean; setBusy: (value: boolean) => void; setMessage: (value: string) => void; householdId: string; onSaved: () => Promise<void>; onNotice: (message: string, tone?: NoticeTone) => void; onNavigate: (target: ManagementTarget) => void; onDeleted: (wineryId: string) => void; onAddPurchase: (visit: VisitRecord, tripId: string | null) => void }) {
  const [linkingPurchase, setLinkingPurchase] = useState(false)
  const winery = data.wineries.find((item) => item.id === visit.wineryId)
  const purchases = data.purchases.filter((purchase) => purchase.wineryVisitId === visit.id)
  const reference = data.travelReferences.find((item) => item.wineryVisitId === visit.id)
  const trip = tripForVisit(data, visit.id)
  const purchaseLines = purchases.flatMap((purchase) => data.purchaseItems.filter((item) => item.purchaseId === purchase.id).map((item) => ({ purchase, item, wine: data.wines.find((wine) => wine.id === item.wineId) })))
  const candidates = unlinkedPurchasesForVisit(data, visit)
  const canDelete = visitCanBeDeleted(data, visit.id)
  const linkPurchase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!supabase || !editable) return
    setBusy(true); setMessage(''); const formElement = event.currentTarget; const form = new FormData(formElement), purchaseId = String(form.get('purchase_id'))
    try {
      const existingReferenceResult = await supabase.from('travel_references').select('id,external_id,display_label').eq('household_id', householdId).eq('purchase_id', purchaseId).eq('external_system', 'travel-journal').eq('external_entity_type', 'trip').maybeSingle()
      if (existingReferenceResult.error) throw existingReferenceResult.error
      const purchaseReference = existingReferenceResult.data
      if (reference && purchaseReference && purchaseReference.external_id !== reference.externalId && !window.confirm(`This purchase is linked to “${purchaseReference.display_label ?? 'another trip'}”. Change it to “${reference.displayLabel ?? trip?.name ?? 'this visit trip'}” and link the purchase to this visit?`)) return
      const linked = await supabase.from('purchases').update({ winery_visit_id: visit.id }).eq('household_id', householdId).eq('id', purchaseId)
      if (linked.error) throw linked.error
      if (reference && purchaseReference?.external_id !== reference.externalId) {
        const payload = { household_id: householdId, purchase_id: purchaseId, winery_visit_id: null, opening_id: null, external_system: 'travel-journal', external_entity_type: 'trip', external_id: reference.externalId, display_label: reference.displayLabel ?? trip?.name ?? 'Linked trip', deep_link_path: reference.deepLinkPath }
        const tripResult = purchaseReference ? await supabase.from('travel_references').update(payload).eq('household_id', householdId).eq('id', purchaseReference.id) : await supabase.from('travel_references').insert(payload)
        if (tripResult.error) { await supabase.from('purchases').update({ winery_visit_id: null }).eq('household_id', householdId).eq('id', purchaseId); throw tripResult.error }
      }
      await finishSuccessfulAction({ form: formElement, refresh: onSaved, finish: () => setLinkingPurchase(false), notice: onNotice, message: 'Purchase linked to visit.' })
    } catch (error) { setMessage(userError(error, 'The purchase could not be linked. Please try again.')) } finally { setBusy(false) }
  }
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!supabase || !editable) return
    setBusy(true); setMessage(''); const formElement = event.currentTarget; const form = new FormData(formElement)
    try {
      const result = await supabase.from('winery_visits').update({ winery_id: String(form.get('winery_id')), visit_date: String(form.get('visit_date')), notes: optional(form, 'notes'), favorite: form.get('favorite') === 'on', would_visit_again: optional(form, 'would_visit_again') }).eq('household_id', householdId).eq('id', visit.id)
      if (result.error) throw result.error
      const tripId = optional(form, 'trip_id')
      if (tripId) {
        if (tripId !== reference?.externalId) {
          const selectedTrip = data.trips.find((item) => item.id === tripId)
          if (!selectedTrip) throw new Error('Choose a valid Travel Journal trip.')
          const payload = { household_id: householdId, winery_visit_id: visit.id, external_system: 'travel-journal', external_entity_type: 'trip', external_id: selectedTrip.id, display_label: selectedTrip.name, deep_link_path: null }
          const linkResult = reference ? await supabase.from('travel_references').update(payload).eq('household_id', householdId).eq('id', reference.id) : await supabase.from('travel_references').insert(payload)
          if (linkResult.error) throw linkResult.error
        }
      } else if (reference) {
        const unlink = await supabase.from('travel_references').delete().eq('household_id', householdId).eq('id', reference.id)
        if (unlink.error) throw unlink.error
      }
      await finishSuccessfulAction({ form: formElement, refresh: onSaved, finish: () => setEditing(false), notice: onNotice, message: 'Visit saved.' })
    } catch (error) { setMessage(userError(error, 'The visit could not be saved. Please try again.')) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!supabase || !editable || !canDelete || !window.confirm('Delete this winery visit? The winery, wines, and purchases will remain.')) return
    setBusy(true); setMessage('')
    try {
      const visitPhotos = photosForVisit(data, visit.id)
      const result = await supabase.from('winery_visits').delete().eq('household_id', householdId).eq('id', visit.id)
      if (result.error) throw result.error
      if (visitPhotos.length) await supabase.storage.from('cellar-photos').remove(visitPhotos.map((photo) => photo.storagePath))
      await finishSuccessfulAction({ refresh: onSaved, finish: () => onDeleted(visit.wineryId), notice: onNotice, message: 'Visit deleted.' })
    } catch (error) { setMessage(userError(error, 'The visit could not be deleted. Please try again.')) } finally { setBusy(false) }
  }
  if (editing) return <form className="workflow-form detail-form edit-record-form" onSubmit={save}><fieldset className="workflow-fields" disabled={busy}>
    <EditSection title="Visit">
      <label>Winery<select name="winery_id" required defaultValue={visit.wineryId}>{data.wineries.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Visit date<input name="visit_date" type="date" required defaultValue={visit.visitDate} /></label>
      <label>Travel Journal trip<select name="trip_id" defaultValue={reference?.externalId ?? ''}><option value="">No linked trip</option>{reference && !trip && <option value={reference.externalId}>{reference.displayLabel ?? 'Linked Travel Journal trip'}</option>}{data.trips.map((item) => <option key={item.id} value={item.id}>{item.name} · {date(item.startDate)}</option>)}</select></label>
      <label>Visit notes<textarea name="notes" rows={5} defaultValue={visit.notes ?? ''} /></label>
      <label>Would visit again<select name="would_visit_again" defaultValue={visit.wouldVisitAgain ?? ''}><option value="">Not set</option><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">No</option></select></label>
      <label className="check-field"><input name="favorite" type="checkbox" defaultChecked={visit.favorite} /> Favorite visit</label>
    </EditSection>
    <div className="form-actions edit-form-actions"><button type="button" data-discard className="secondary-button" onClick={() => setEditing(false)} disabled={busy}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save visit'}</button></div>
    <section className="delete-record-section"><button type="button" className="delete-record-button" onClick={() => void remove()} disabled={busy || !canDelete}>Delete Visit</button>{!canDelete && <small>This visit has linked purchases, so it cannot be deleted without changing history.</small>}</section>
  </fieldset></form>
  return <div className="detail-content">
    {winery && <section className="detail-section"><h3>Winery</h3><RecordLink title={winery.name} subtitle={[winery.city, winery.state].filter(Boolean).join(', ')} onClick={() => onNavigate({ kind: 'winery', record: winery })} /></section>}
    <section className="detail-section"><h3>Visit memory</h3><dl className="fact-grid"><Fact label="Date" value={date(visit.visitDate)} /><Fact label="Visit again" value={visit.wouldVisitAgain ?? 'Not specified'} />{reference && <Fact label="Travel Journal trip" value={trip?.name ?? reference.displayLabel ?? 'Linked trip'} />}</dl>{visit.notes && <p>{visit.notes}</p>}</section>
    <section className="detail-section"><div className="section-action-heading"><h3>Purchased During This Visit</h3>{editable && <div className="section-actions"><button className="secondary-button compact-button" onClick={() => onAddPurchase(visit, reference?.externalId ?? null)}>Add Wine Purchase</button>{candidates.length > 0 && <button className="text-button compact-button" onClick={() => setLinkingPurchase(true)}>Link Purchase</button>}</div>}</div>
      {linkingPurchase && <form className="visit-link-form" onSubmit={linkPurchase}><label>Existing purchase<select name="purchase_id" required defaultValue=""><option value="" disabled>Select a purchase</option>{candidates.map((purchase) => { const items = data.purchaseItems.filter((item) => item.purchaseId === purchase.id), names = items.map((item) => data.wines.find((wine) => wine.id === item.wineId)?.name).filter(Boolean).join(', '), bottles = items.reduce((sum, item) => sum + item.quantity, 0); return <option key={purchase.id} value={purchase.id}>{purchase.acquisitionDate ? date(purchase.acquisitionDate) : 'Date unknown'} · {names || 'Purchase'} · {bottles} {bottles === 1 ? 'bottle' : 'bottles'}</option> })}</select></label><div className="form-actions"><button type="button" data-discard className="secondary-button" onClick={() => setLinkingPurchase(false)} disabled={busy}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Linking…' : 'Link Purchase'}</button></div></form>}
      {purchaseLines.length ? <div className="visit-purchase-list">{purchaseLines.map(({ item, wine }) => { if (!wine) return null; const hero = data.photos.find((photo) => photo.wineId === wine.id && photo.isHero) ?? data.photos.find((photo) => photo.wineId === wine.id); return <button className="visit-purchase-line" key={item.id} onClick={() => onNavigate({ kind: 'wine', record: wine })}>{hero && <span className="visit-purchase-photo">{photoUrls[hero.id] ? <img src={photoUrls[hero.id]} alt="" /> : null}</span>}<span><strong>{wine.name}</strong><small>{wine.nonVintage ? 'NV' : wine.vintage ?? 'Vintage not set'} · {item.quantity} {item.quantity === 1 ? 'bottle' : 'bottles'}{item.totalCost == null ? '' : ` · ${money(item.totalCost)}`}</small></span><span aria-hidden="true">›</span></button> })}</div> : !linkingPurchase && <p className="empty-copy compact">No purchases are linked to this visit yet.</p>}
    </section>
  </div>
}

function Fact({ label, value }: { label: string; value?: string | null }) { return <div><dt>{label}</dt><dd>{value || 'Not set'}</dd></div> }
function RecordLink({ title, subtitle, onClick }: { title: string; subtitle?: string; onClick: () => void }) { return <button className="record-link" onClick={onClick}><span><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span><span aria-hidden="true">›</span></button> }
function wineLinkSubtitle(wine: WineRecord, extra?: string) { return [wine.nonVintage ? 'NV' : wine.vintage ?? 'Vintage not set', extra, wine.agingCount ? `${wine.agingCount} Aging` : null, wine.agingHoldUntilYear ? `Hold: ${wine.agingHoldUntilYear}` : null].filter(Boolean).join(' · ') }

function History({ target, data, onNavigate }: { target: ManagementTarget; data: CellarData; onNavigate: (target: ManagementTarget) => void }) {
  const wine = target.kind === 'wine' ? target.record : target.kind === 'opening' || target.kind === 'gift' ? data.wines.find((item) => item.id === target.record.wineId) : null
  const winery = target.kind === 'winery' ? target.record : target.kind === 'visit' ? data.wineries.find((item) => item.id === target.record.wineryId) : null
  const purchaseOnly = target.kind === 'purchase' ? target.record.id : null, openingOnly = target.kind === 'opening' ? target.record.id : null, giftOnly = target.kind === 'gift' ? target.record.id : null, visitOnly = target.kind === 'visit' ? target.record.id : null
  const events: Array<{ key: string; at: string | null; title: string; body: string; target: ManagementTarget }> = []
  if (!['opening', 'gift', 'visit', 'winery'].includes(target.kind)) for (const item of data.purchaseItems.filter((entry) => (!wine || entry.wineId === wine.id) && (!purchaseOnly || entry.purchaseId === purchaseOnly))) { const purchase = data.purchases.find((entry) => entry.id === item.purchaseId), itemWine = data.wines.find((entry) => entry.id === item.wineId); if (purchase) { const receivedAsGift = purchase.acquisitionType === 'gift'; events.push({ key: `purchase-${item.id}`, at: purchase.acquisitionDate, title: `${receivedAsGift ? 'Received as a gift' : 'Purchased'} · ${item.quantity} bottle${item.quantity === 1 ? '' : 's'}${itemWine && !wine ? ` · ${itemWine.name}` : ''}`, body: receivedAsGift ? [purchase.giftFrom ? `From ${purchase.giftFrom}` : null, purchase.notes].filter(Boolean).join(' · ') : [purchase.purchaseLocation, item.totalCost == null ? null : money(item.totalCost), purchase.purchasedBy].filter(Boolean).join(' · '), target: { kind: 'purchase', record: purchase } }) } }
  if (!['purchase', 'gift', 'visit', 'winery'].includes(target.kind)) for (const opening of data.openings.filter((entry) => (!wine || entry.wineId === wine.id) && (!openingOnly || entry.id === openingOnly))) { const itemWine = data.wines.find((entry) => entry.id === opening.wineId); events.push({ key: `opening-${opening.id}`, at: opening.openedAt, title: `${opening.status === 'open' ? 'Bottle opened' : 'Bottle enjoyed'}${itemWine && !wine ? ` · ${itemWine.name}` : ''}`, body: [opening.openedBy, opening.occasion, opening.memoryNotes].filter(Boolean).join(' · '), target: { kind: 'opening', record: opening } }) }
  if (!['purchase', 'opening', 'visit', 'winery'].includes(target.kind)) for (const gift of data.giftsGiven.filter((entry) => (!wine || entry.wineId === wine.id) && (!giftOnly || entry.id === giftOnly))) { const itemWine = data.wines.find((entry) => entry.id === gift.wineId); events.push({ key: `gift-${gift.id}`, at: gift.giftedOn, title: `1 bottle gifted to ${gift.giftedTo}${itemWine && !wine ? ` · ${itemWine.name}` : ''}`, body: gift.occasionNote ?? '', target: { kind: 'gift', record: gift } }) }
  if (!['purchase', 'opening', 'gift', 'wine'].includes(target.kind)) for (const visit of data.visits.filter((entry) => (!winery || entry.wineryId === winery.id) && (!visitOnly || entry.id === visitOnly))) { const itemWinery = data.wineries.find((entry) => entry.id === visit.wineryId); events.push({ key: `visit-${visit.id}`, at: visit.visitDate, title: `Winery visit${itemWinery && !winery ? ` · ${itemWinery.name}` : ''}`, body: visit.notes ?? '', target: { kind: 'visit', record: visit } }) }
  events.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
  return <div className="history-list">{events.length ? events.map((event) => <button className="history-card" key={event.key} onClick={() => onNavigate(event.target)}><small>{event.at ? date(event.at) : 'Date unknown'}</small><strong>{event.title}</strong>{event.body && <p>{event.body}</p>}<span aria-hidden="true">›</span></button>) : <p className="empty-copy">No history yet.</p>}</div>
}

function Favorites({ data, onNavigate }: { data: CellarData; onNavigate: (target: ManagementTarget) => void }) { const wines = data.wines.filter((wine) => wine.favorite || data.preferences.some((preference) => preference.wineId === wine.id && preference.favorite)); return <div className="record-list standalone-list">{wines.length ? wines.map((wine) => <RecordLink key={wine.id} title={wine.name} subtitle={`${wine.wineryName ?? 'Winery not set'} · ${wineLinkSubtitle(wine)}`} onClick={() => onNavigate({ kind: 'wine', record: wine })} />) : <p className="empty-copy">Favorites will appear here as each household member marks them.</p>}</div> }

function PhotoPanel({ target, householdId, photos, urls, editable, busy, autoAdd, onPrompted, setBusy, setMessage, onSaved, onNotice, onView }: { target: ManagementTarget; householdId: string; photos: PhotoRecord[]; urls: Record<string, string>; editable: boolean; busy: boolean; autoAdd: boolean; onPrompted: () => void; setBusy: (value: boolean) => void; setMessage: (value: string) => void; onSaved: () => Promise<void>; onNotice: (message: string, tone?: NoticeTone) => void; onView: (photo: PhotoRecord) => void }) {
  const [adding, setAdding] = useState(autoAdd)
  useEffect(() => { if (autoAdd && editable) { setAdding(true); onPrompted() } }, [autoAdd, editable, onPrompted])
  const pendingUpload = useRef<null | (() => Promise<void>)>(null)
  const [retryingPhoto, setRetryingPhoto] = useState(false)
  const uploading = useRef(false)
  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || !('record' in target) || uploading.current) return
    const formElement = event.currentTarget
    uploading.current = true; setBusy(true); setMessage('')
    try {
      if (!pendingUpload.current) {
        const form = new FormData(formElement), file = form.get('photo')
        if (!(file instanceof File) || !file.size) throw new Error('Choose a photo.')
        const column = target.kind === 'wine' ? 'wine_id' : target.kind === 'winery' ? 'winery_id' : target.kind === 'opening' ? 'opening_id' : target.kind === 'purchase' ? 'purchase_id' : 'winery_visit_id'
        const photographedOn = optional(form, 'photographed_at')
        pendingUpload.current = createPhotoUpload(supabase, file, householdId, `${target.kind}/${target.record.id}`, { [column]: target.record.id }, { caption: optional(form, 'caption'), photographed_at: photographedOn ? `${photographedOn}T12:00:00` : null, is_hero: ['wine', 'winery', 'visit'].includes(target.kind) && photos.length === 0 })
      }
      await pendingUpload.current()
      pendingUpload.current = null; setRetryingPhoto(false)
      await finishSuccessfulAction({ form: formElement, refresh: onSaved, finish: () => { formElement.reset(); setAdding(false) }, notice: onNotice, message: 'Photo added.' })
    } catch (error) {
      setRetryingPhoto(Boolean(pendingUpload.current))
      setMessage(userError(error, 'The photo could not be added. Retry Photo to retry this attachment.'))
    } finally { uploading.current = false; setBusy(false) }
  }
  const setHero = async (photo: PhotoRecord) => { if (!supabase || (target.kind !== 'wine' && target.kind !== 'winery' && target.kind !== 'visit')) return; setBusy(true); setMessage(''); const column = target.kind === 'wine' ? 'wine_id' : target.kind === 'winery' ? 'winery_id' : 'winery_visit_id', previousHero = photos.find((item) => item.isHero); const reset = await supabase.from('photos').update({ is_hero: false }).eq('household_id', householdId).eq(column, target.record.id); const result = reset.error ? reset : await supabase.from('photos').update({ is_hero: true }).eq('household_id', householdId).eq('id', photo.id); if (result.error) { if (!reset.error && previousHero) await supabase.from('photos').update({ is_hero: true }).eq('household_id', householdId).eq('id', previousHero.id); setMessage(userError(result.error, 'The hero photo could not be changed.')) } else await finishSuccessfulAction({ refresh: onSaved, notice: onNotice, message: 'Hero photo updated.' }); setBusy(false) }
  const remove = async (photo: PhotoRecord) => { if (!supabase || !window.confirm('Remove this photo permanently?')) return; setBusy(true); setMessage(''); const result = await supabase.from('photos').delete().eq('household_id', householdId).eq('id', photo.id); if (result.error) setMessage(userError(result.error, 'The photo could not be removed.')); else { await supabase.storage.from('cellar-photos').remove([photo.storagePath]); const supportsHero = target.kind === 'wine' || target.kind === 'winery' || target.kind === 'visit', nextHero = supportsHero && photo.isHero ? photos.find((item) => item.id !== photo.id) : null; if (nextHero) await supabase.from('photos').update({ is_hero: true }).eq('household_id', householdId).eq('id', nextHero.id); await finishSuccessfulAction({ refresh: onSaved, notice: onNotice, message: 'Photo deleted.' }) } setBusy(false) }
  return <section className="photo-panel"><div className="photo-panel-lead"><p>Private to signed-in household members.</p>{editable && <button className="camera-button" type="button" onClick={() => setAdding(true)} disabled={busy} aria-label="Add photo">＋</button>}</div>{adding && <form className="photo-add-form workflow-form" onSubmit={upload}><fieldset className="workflow-fields" disabled={busy || retryingPhoto}><PhotoPicker label="Add photo" required /><div className="field-grid"><label>Caption<input name="caption" /></label><label>Photo date<input name="photographed_at" type="date" /></label></div></fieldset><div className="form-actions"><button className="secondary-button" type="button" data-discard onClick={() => { setAdding(false); pendingUpload.current = null; setRetryingPhoto(false) }} disabled={busy}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Adding…' : retryingPhoto ? 'Retry Photo' : 'Add photo'}</button></div></form>}{photos.length ? <div className="gallery">{photos.map((photo) => <figure key={photo.id}><button data-keep-draft className="gallery-image" onClick={() => onView(photo)}>{urls[photo.id] ? <img src={urls[photo.id]} alt={photo.caption ?? 'Cellar photo'} /> : <span>Loading…</span>}</button><figcaption>{photo.caption ?? (photo.isHero ? 'Hero photo' : 'Photo')}{photo.photographedAt && <small>{date(photo.photographedAt)}</small>}</figcaption>{editable && <div className="photo-actions">{(target.kind === 'wine' || target.kind === 'winery' || target.kind === 'visit') && <button onClick={() => void setHero(photo)} disabled={busy || photo.isHero}>{photo.isHero ? 'Hero' : 'Make hero'}</button>}<button onClick={() => void remove(photo)} disabled={busy}>Delete</button></div>}</figure>)}</div> : !adding && <button className="photo-empty" type="button" onClick={() => setAdding(true)} disabled={!editable || busy}><span>◇</span><p>{editable ? 'Add the first photo' : 'No photos yet.'}</p></button>}</section>
}

function PhotoViewer({ photo, photos, urls, onSelect, onClose }: { photo: PhotoRecord; photos: PhotoRecord[]; urls: Record<string,string>; onSelect: (photo: PhotoRecord) => void; onClose: () => void }) { const index = photos.findIndex((item) => item.id === photo.id), previous = index > 0 ? photos[index - 1] : null, next = index >= 0 && index < photos.length - 1 ? photos[index + 1] : null; return <LightboxLayer ariaLabel="Photo viewer" onDismiss={onClose}><button className="photo-viewer-close" onClick={onClose} aria-label="Close photo">×</button>{previous && <button className="photo-viewer-nav previous" onClick={() => onSelect(previous)} aria-label="Previous photo">‹</button>}<figure>{urls[photo.id] ? <img src={urls[photo.id]} alt={photo.caption ?? 'Cellar photo'} /> : <p className="photo-viewer-loading">Loading photo…</p>}{(photo.caption || photo.photographedAt) && <figcaption>{photo.caption}{photo.caption && photo.photographedAt ? ' · ' : ''}{photo.photographedAt ? date(photo.photographedAt) : ''}</figcaption>}</figure>{next && <button className="photo-viewer-nav next" onClick={() => onSelect(next)} aria-label="Next photo">›</button>}</LightboxLayer> }

function Statistics({ data }: { data: CellarData }) { const byStyle = Object.entries(data.wines.reduce<Record<string, number>>((result, wine) => { const key = wine.category ?? wine.style ?? 'Uncategorized'; result[key] = (result[key] ?? 0) + wine.availableQuantity; return result }, {})).sort((a, b) => b[1] - a[1]); return <><div className="snapshot-grid modal-snapshot"><article className="snapshot-card"><strong>{data.snapshot.purchasedBottles}</strong><span>Purchased</span></article><article className="snapshot-card"><strong>{data.snapshot.giftsReceived}</strong><span>Gifts received</span></article><article className="snapshot-card"><strong>{data.snapshot.bottlesEnjoyed}</strong><span>Opened / consumed</span></article><article className="snapshot-card"><strong>{data.snapshot.giftedAway}</strong><span>Gifted away</span></article><article className="snapshot-card"><strong>{data.snapshot.currentBottles}</strong><span>Currently on hand</span></article><article className="snapshot-card"><strong>{money(data.snapshot.recordedValue)}</strong><span>Recorded value</span></article></div><section className="detail-section"><h3>Collection by style</h3>{byStyle.map(([label, value]) => <div className="stat-row" key={label}><span>{label}</span><i style={{ width: `${value / Math.max(1, ...byStyle.map((row) => row[1])) * 100}%` }} /><strong>{value}</strong></div>)}</section></> }

function Storage({ data, householdId, editable, onSaved, onNotice }: { data: CellarData; householdId: string; editable: boolean; onSaved: () => Promise<void>; onNotice: (message: string, tone?: NoticeTone) => void }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const [mode, setMode] = useState<'move' | 'adjust_out' | 'adjust_in' | 'location'>('move')
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const formElement = event.currentTarget; if (!supabase || !editable) return; setBusy(true); setMessage(''); const form = new FormData(formElement); try { const mode = String(form.get('mode')); if (mode === 'location') { const result = await supabase.from('storage_locations').insert({ household_id: householdId, name: String(form.get('name')).trim(), location_type: optional(form, 'location_type') || 'area', description: optional(form, 'description') }); if (result.error) throw result.error } else { const [itemId, locationId] = String(form.get('bottle_lot')).split('|'), quantity = Number(form.get('quantity')); const result = mode === 'move' ? await supabase.rpc('move_inventory', { p_household_id: householdId, p_purchase_item_id: itemId, p_from_location_id: locationId, p_to_location_id: String(form.get('to_location_id')), p_quantity: quantity, p_reason: optional(form, 'reason') }) : await supabase.rpc('adjust_inventory', { p_household_id: householdId, p_purchase_item_id: itemId, p_storage_location_id: locationId, p_quantity_delta: mode === 'adjust_in' ? quantity : -quantity, p_reason: String(form.get('reason')).trim() }); if (result.error) throw result.error } await finishSuccessfulAction({ form: formElement, refresh: onSaved, finish: () => { formElement.reset(); formElement.closest('details')?.removeAttribute('open') }, notice: onNotice, message: 'Storage updated.' }) } catch (error) { setMessage(userError(error, 'The storage change could not be saved. Please try again.')) } finally { setBusy(false) } }
  return <><div className="record-list standalone-list">{data.locations.map((location) => <article className="static-record" key={location.id}><strong>{location.name}</strong><small>{location.locationType} · {data.bottleLots.filter((lot) => lot.storageLocationId === location.id).reduce((sum, lot) => sum + lot.quantity, 0)} bottles</small></article>)}</div>{editable && <details className="more-details standalone-details"><summary>Manage storage</summary><form className="workflow-form" aria-busy={busy} onSubmit={submit}><label>Action<select name="mode" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="move">Move bottles</option><option value="adjust_out">Reduce count</option><option value="adjust_in">Increase count</option><option value="location">Add storage area</option></select></label>{mode === 'location' ? <Fragment key="location"><label>New area name<input name="name" required /></label><label>Area type<input name="location_type" defaultValue="area" /></label><label>Description<input name="description" /></label></Fragment> : <Fragment key={mode}><label>Bottle lot<select name="bottle_lot" required defaultValue=""><option value="" disabled>Choose a lot</option>{data.bottleLots.map((lot) => <option key={`${lot.purchaseItemId}-${lot.storageLocationId}`} value={`${lot.purchaseItemId}|${lot.storageLocationId}`}>{lot.wineLabel} · {lot.storageLocationName} ({lot.quantity})</option>)}</select></label>{mode === 'move' && <label>Destination<select name="to_location_id" required defaultValue=""><option value="" disabled>Choose destination</option>{data.locations.filter((location) => location.isActive).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>}<label>Quantity<input name="quantity" type="number" min="0.01" step="0.01" defaultValue="1" required /></label><label>Reason<input name="reason" required={mode !== 'move'} /></label></Fragment>}<button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save storage change'}</button></form></details>}{message && <p className="form-message error" role="alert">{message}</p>}</>
}

function Documents({ householdId, data, editable, onSaved, onNotice, onNavigate }: { householdId: string; data: CellarData; editable: boolean; onSaved: () => Promise<void>; onNotice: (message: string, tone?: NoticeTone) => void; onNavigate: (target: ManagementTarget) => void }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const upload = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const formElement = event.currentTarget; if (!supabase) return; setBusy(true); const form = new FormData(formElement), file = form.get('file'); try { if (!(file instanceof File) || !file.size) throw new Error('Choose a receipt or document.'); const purchaseId = String(form.get('purchase_id')), path = `${householdId}/purchases/${purchaseId}/${createUniqueId()}-${safeName(file.name)}`; const stored = await supabase.storage.from('cellar-documents').upload(path, file, { contentType: file.type, upsert: false }); if (stored.error) throw stored.error; const result = await supabase.from('documents').insert({ household_id: householdId, purchase_id: purchaseId, document_type: optional(form, 'document_type') || 'receipt', display_title: String(form.get('display_title')).trim(), document_date: optional(form, 'document_date'), storage_path: path, original_filename: file.name, mime_type: file.type, file_size_bytes: file.size }); if (result.error) { await supabase.storage.from('cellar-documents').remove([path]); throw result.error } await finishSuccessfulAction({ form: formElement, refresh: onSaved, finish: () => { formElement.reset(); formElement.closest('details')?.removeAttribute('open') }, notice: onNotice, message: 'Document uploaded.' }) } catch (error) { setMessage(userError(error, 'The document could not be uploaded. Please try again.')) } finally { setBusy(false) } }
  const open = async (path: string) => { if (!supabase) return; setMessage(''); const result = await supabase.storage.from('cellar-documents').createSignedUrl(path, 120); if (result.error) setMessage(userError(result.error, 'The document could not be opened. Please try again.')); else window.open(result.data.signedUrl, '_blank', 'noopener,noreferrer') }
  return <><div className="record-list standalone-list">{data.documents.length ? data.documents.map((document) => { const purchase = data.purchases.find((item) => item.id === document.purchaseId); return <div className="document-row" key={document.id}><button onClick={() => void open(document.storagePath)}><strong>{document.displayTitle}</strong><small>{document.originalFilename}{document.documentDate ? ` · ${date(document.documentDate)}` : ''}</small></button>{purchase && <button className="document-purchase" onClick={() => onNavigate({ kind: 'purchase', record: purchase })}>Purchase ›</button>}</div> }) : <p className="empty-copy">No receipts or documents yet.</p>}</div>{editable && <details className="more-details standalone-details"><summary>Upload document</summary><form className="workflow-form" aria-busy={busy} onSubmit={upload}><label>Purchase<select name="purchase_id" required defaultValue=""><option value="" disabled>Select purchase</option>{data.purchases.map((purchase) => <option key={purchase.id} value={purchase.id}>{purchase.acquisitionDate ?? 'Date unknown'} · {purchase.purchaseLocation ?? 'Purchase'}</option>)}</select></label><label>Title<input name="display_title" required placeholder="Receipt" /></label><label>Type<select name="document_type"><option value="receipt">Receipt</option><option value="invoice">Invoice</option><option value="other">Other</option></select></label><label>File<input name="file" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" required /></label><button className="primary-button" disabled={busy}>{busy ? 'Uploading…' : 'Upload private document'}</button></form></details>}{message && <p className="form-message error" role="alert">{message}</p>}</>
}

function Empty({ title, text }: { title: string; text: string }) { return <article className="empty-feature modal-empty"><div><h3>{title}</h3><p>{text}</p></div></article> }
