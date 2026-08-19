import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { WorkflowModal } from './WorkflowModal'
import { ManagementModal, type ManagementTarget } from './ManagementModal'
import { EMPTY_CELLAR_DATA, loadCellarData, type CellarData, type WineRecord, type WineryRecord } from './lib/cellar-data'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import type { HouseholdContext, NavView, QuickAction } from './lib/types'

const QUICK_ACTIONS: Array<{ id: QuickAction; label: string; hint: string; icon: IconName }> = [
  { id: 'add-wine', label: 'Add Wine', hint: 'Create a wine definition', icon: 'bottle' },
  { id: 'record-purchase', label: 'Add Bottles', hint: 'Purchased or received as a gift', icon: 'receipt' },
  { id: 'open-bottle', label: 'Bottle Leaving', hint: 'Opened or given as a gift', icon: 'open' },
  { id: 'add-winery', label: 'Add Winery', hint: 'Create a winery profile', icon: 'winery' },
  { id: 'add-winery-visit', label: 'Add Winery Visit', hint: 'Save a visit and its photos', icon: 'visit' },
]

type IconName =
  | 'home'
  | 'cellar'
  | 'plus'
  | 'winery'
  | 'more'
  | 'search'
  | 'bottle'
  | 'receipt'
  | 'open'
  | 'visit'
  | 'heart'
  | 'travel'
  | 'history'
  | 'storage'
  | 'document'
  | 'statistics'
  | 'settings'
  | 'chevron'
  | 'close'

function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    home: <><path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10.5V20h11v-9.5M10 20v-6h4v6"/></>,
    cellar: <><path d="M5 4h14v16H5z"/><path d="M5 9h14M5 14h14M9 4v16M15 4v16"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    winery: <><path d="M6 20h12M8 20V9h8v11M7 9h10l-2-5H9L7 9Z"/><path d="M10 13h4M10 16h4"/></>,
    more: <><circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
    bottle: <><path d="M10 3h4v4l2 3v10H8V10l2-3V3Z"/><path d="M10 6h4M8 13h8"/></>,
    receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
    open: <><path d="M9 3h6M10 3v4l-3 4v8h10v-8l-3-4V3"/><path d="M7 14h10"/><path d="m18 4 1 1m0-1-1 1"/></>,
    visit: <><path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/></>,
    heart: <path d="M20 8.5c0 5-8 10.5-8 10.5S4 13.5 4 8.5A4.5 4.5 0 0 1 12 5.7a4.5 4.5 0 0 1 8 2.8Z"/>,
    travel: <><path d="M4 17 20 7M7 7h5v5M12 17h5v-5"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/></>,
    history: <><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6"/><path d="M4 4v4.6h4.6M12 7v5l3 2"/></>,
    storage: <><path d="M4 6h16v14H4zM7 3h10v3"/><path d="M8 10h8M8 14h8"/></>,
    document: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/></>,
    statistics: <><path d="M5 20V10h3v10M11 20V5h3v15M17 20v-7h3v7"/><path d="M3 20h19"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7a7 7 0 0 0-.7-1.7l.9-1.9-2.1-2.1-1.9.9a7 7 0 0 0-1.7-.7L10.5 2h-3l-.7 2a7 7 0 0 0-1.7.7l-1.9-.9L1.1 6l.9 1.9a7 7 0 0 0-.7 1.7L0 10.5v3l2 .7a7 7 0 0 0 .7 1.7l-.9 1.9 2.1 2.1 1.9-.9a7 7 0 0 0 1.7.7l.7 2h3l.7-2a7 7 0 0 0 1.7-.7l1.9.9 2.1-2.1-.9-1.9a7 7 0 0 0 .7-1.7l1.6-.7Z" transform="translate(2) scale(.83)"/></>,
    chevron: <path d="m9 6 6 6-6 6"/>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  )
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function useHashView() {
  const read = (): NavView => {
    const value = window.location.hash.replace('#/', '')
    return value === 'cellar' || value === 'wineries' || value === 'more' ? value : 'home'
  }
  const [view, setView] = useState<NavView>(read)
  useEffect(() => {
    const sync = () => setView(read())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  const go = (next: NavView) => {
    window.location.hash = `/${next}`
    setView(next)
    document.querySelector('.app-scroll')?.scrollTo({ top: 0, behavior: 'smooth' })
  }
  return { view, go }
}

function App() {
  const allowDemo = import.meta.env.VITE_ENABLE_DEMO_SHELL === 'true'
  if (!isSupabaseConfigured) return <SetupState allowDemo={allowDemo} />
  return <AuthBoundary />
}

function SetupState({ allowDemo }: { allowDemo: boolean }) {
  const [preview, setPreview] = useState(allowDemo)
  if (preview) {
    return (
      <CellarShell
        household={{ householdId: 'preview', role: 'owner', displayName: 'Our Cellar' }}
        preview
        onSignOut={() => setPreview(false)}
      />
    )
  }
  return (
    <main className="setup-page">
      <section className="setup-card brass-corners">
        <BrandMark />
        <p className="eyebrow">THE CELLAR</p>
        <h1>Cloud foundation ready</h1>
        <p>Add the isolated Supabase project URL and publishable key to finish connecting this deployment.</p>
        {allowDemo && <button className="primary-button" onClick={() => setPreview(true)}>Preview the visual shell</button>}
      </section>
    </main>
  )
}

function AuthBoundary() {
  const [session, setSession] = useState<Session | null>(null)
  const [household, setHousehold] = useState<HouseholdContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [membershipError, setMembershipError] = useState('')

  useEffect(() => {
    const client = supabase
    if (!client) return
    const activate = async (nextSession: Session | null) => {
      setSession(nextSession)
      setHousehold(null)
      setMembershipError('')
      if (!nextSession) {
        setLoading(false)
        return
      }
      setLoading(true)
      const { data, error } = await client
        .from('household_members')
        .select('household_id, role, households(name)')
        .eq('user_id', nextSession.user.id)
        .maybeSingle()
      if (error || !data) {
        setMembershipError(error?.message || 'This account does not have access to The Cellar.')
      } else {
        const related = data.households as unknown as { name?: string } | null
        setHousehold({
          householdId: data.household_id,
          role: data.role,
          displayName: related?.name || 'Our Cellar',
        })
      }
      setLoading(false)
    }
    client.auth.getSession().then(({ data }) => activate(data.session))
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      window.setTimeout(() => activate(nextSession), 0)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  if (loading) return <LoadingState />
  if (!session) return <SignIn />
  if (!household) return <MembershipState message={membershipError} />
  return <CellarShell household={household} onSignOut={() => supabase?.auth.signOut()} />
}

function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    const result = await supabase!.auth.signInWithPassword({ email: email.trim(), password })
    if (result.error) setMessage(result.error.message)
    setBusy(false)
  }
  return (
    <main className="auth-page">
      <form className="auth-card brass-corners" onSubmit={submit}>
        <BrandMark />
        <p className="eyebrow">PRIVATE COLLECTION</p>
        <h1>The Cellar</h1>
        <p className="auth-intro">Our wine collection &amp; memories</p>
        <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {message && <p className="form-message error">{message}</p>}
        <button className="primary-button" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
        <small>Accounts are created privately by an administrator.</small>
      </form>
    </main>
  )
}

function LoadingState() {
  return <main className="loading-page"><BrandMark /><span className="loading-line"/><p>Opening The Cellar...</p></main>
}

function MembershipState({ message }: { message: string }) {
  return (
    <main className="setup-page">
      <section className="setup-card brass-corners"><BrandMark /><h1>Access pending</h1><p>{message}</p><button className="secondary-button" onClick={() => supabase?.auth.signOut()}>Sign out</button></section>
    </main>
  )
}

function BrandMark() {
  return <div className="brand-mark" aria-hidden="true"><span>C</span></div>
}

function currentTarget(target: ManagementTarget | null, data: CellarData) {
  if (!target || !('record' in target)) return target
  if (target.kind === 'wine') return { kind: 'wine' as const, record: data.wines.find((item) => item.id === target.record.id) ?? target.record }
  if (target.kind === 'winery') return { kind: 'winery' as const, record: data.wineries.find((item) => item.id === target.record.id) ?? target.record }
  if (target.kind === 'opening') return { kind: 'opening' as const, record: data.openings.find((item) => item.id === target.record.id) ?? target.record }
  if (target.kind === 'purchase') return { kind: 'purchase' as const, record: data.purchases.find((item) => item.id === target.record.id) ?? target.record }
  if (target.kind === 'gift') return { kind: 'gift' as const, record: data.giftsGiven.find((item) => item.id === target.record.id) ?? target.record }
  return { kind: 'visit' as const, record: data.visits.find((item) => item.id === target.record.id) ?? target.record }
}

function CellarShell({ household, preview = false, onSignOut }: { household: HouseholdContext; preview?: boolean; onSignOut: () => void }) {
  const { view, go } = useHashView()
  const [quickOpen, setQuickOpen] = useState(false)
  const [activeAction, setActiveAction] = useState<QuickAction | null>(null)
  const [openingWineId, setOpeningWineId] = useState<string | null>(null)
  const [updateReady, setUpdateReady] = useState(false)
  const [data, setData] = useState<CellarData>(EMPTY_CELLAR_DATA)
  const [dataLoading, setDataLoading] = useState(!preview)
  const [dataError, setDataError] = useState('')
  const [managementStack, setManagementStack] = useState<ManagementTarget[]>([])
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const managementTarget = managementStack.at(-1) ?? null
  const visibleManagementTarget = currentTarget(managementTarget, data)

  const refresh = useCallback(async () => {
    if (preview || !supabase) {
      setData(EMPTY_CELLAR_DATA)
      setDataLoading(false)
      return
    }
    setDataLoading(true)
    setDataError('')
    try {
      setData(await loadCellarData(supabase, household.householdId))
    } catch (error) {
      setDataError(error instanceof Error ? error.message : 'The collection could not be loaded.')
    } finally {
      setDataLoading(false)
    }
  }, [household.householdId, preview])

  useEffect(() => {
    const ready = () => setUpdateReady(true)
    window.addEventListener('cellar-update-ready', ready)
    return () => window.removeEventListener('cellar-update-ready', ready)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    let active = true
    const loadPhotos = async () => {
      if (!supabase || !data.photos.length) {
        if (active) setPhotoUrls({})
        return
      }
      const next: Record<string, string> = {}
      await Promise.all(data.photos.map(async (photo) => {
        const result = await supabase!.storage.from('cellar-photos').createSignedUrl(photo.storagePath, 3600)
        if (!result.error) next[photo.id] = result.data.signedUrl
      }))
      if (active) setPhotoUrls(next)
    }
    void loadPhotos()
    return () => { active = false }
  }, [data.photos])

  const title = useMemo(() => ({ home: 'The Cellar', cellar: 'Our Cellar', wineries: 'Wineries', more: 'More' })[view], [view])
  const startAction = (action: QuickAction, wineId: string | null = null) => {
    setQuickOpen(false)
    if (household.role === 'viewer') {
      setDataError('This account has view-only access. An owner can change that in household membership.')
      return
    }
    setOpeningWineId(action === 'open-bottle' ? wineId : null)
    setActiveAction(action)
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <div><p className="eyebrow">OUR HOUSEHOLD</p><h1>{title}</h1>{view === 'home' && <p className="header-subtitle">Our wine collection &amp; memories</p>}</div>
          <BrandMark />
        </div>
      </header>
      {preview && <div className="preview-banner">Visual preview - no production wine data</div>}
      {updateReady && <button className="update-banner" onClick={() => window.location.reload()}>A new version is ready. Tap to refresh.</button>}
      {dataError && <button className="data-error" onClick={() => setDataError('')}>{dataError} <span>Dismiss</span></button>}
      <main className="app-scroll">
        {view === 'home' && <HomeView data={data} loading={dataLoading} photoUrls={photoUrls} go={go} onManage={(target) => setManagementStack([target])} />}
        {view === 'cellar' && <CellarView data={data} loading={dataLoading} photoUrls={photoUrls} onManage={(target) => setManagementStack([target])} />}
        {view === 'wineries' && <WineriesView data={data} loading={dataLoading} photoUrls={photoUrls} onManage={(target) => setManagementStack([target])} />}
        {view === 'more' && <MoreView household={household} onSignOut={onSignOut} onManage={(target) => setManagementStack([target])} />}
      </main>
      <BottomNav view={view} go={go} onQuick={() => setQuickOpen(true)} />
      {quickOpen && <QuickActions onClose={() => setQuickOpen(false)} onSelect={startAction} />}
      {activeAction && <WorkflowModal action={activeAction} householdId={household.householdId} data={data} initialWineId={openingWineId} onClose={() => setActiveAction(null)} onSaved={refresh} />}
      {visibleManagementTarget && <ManagementModal target={visibleManagementTarget} householdId={household.householdId} data={data} photoUrls={photoUrls} editable={household.role !== 'viewer'} canGoBack={managementStack.length > 1} onBack={() => setManagementStack((stack) => stack.slice(0, -1))} onClose={() => setManagementStack([])} onNavigate={(target) => setManagementStack((stack) => [...stack, target])} onSaved={refresh} onOpenBottle={(wineId) => { setManagementStack([]); startAction('open-bottle', wineId) }} />}
    </div>
  )
}

function HomeView({ data, loading, photoUrls, go, onManage }: { data: CellarData; loading: boolean; photoUrls: Record<string, string>; go: (view: NavView) => void; onManage: (target: ManagementTarget) => void }) {
  const recent = data.wines.slice(0, 4)
  const recentOpenings = data.openings.slice(0, 3)
  return (
    <div className="screen home-screen">
      <section className="hero brass-corners"><div className="hero-copy"><p className="eyebrow">OUR COLLECTION</p><h2>Every bottle has a story.</h2><p>Browse the wines we have and the memories connected to them.</p></div></section>
      <section className="snapshot-grid" aria-label="Collection snapshot">
        <SnapshotCard value={loading ? '—' : data.snapshot.currentBottles.toString()} label="Current bottles" />
        <SnapshotCard value={loading ? '—' : formatMoney(data.snapshot.recordedValue)} label="Recorded value" />
        <SnapshotCard value={loading ? '—' : data.snapshot.bottlesEnjoyed.toString()} label="Bottles enjoyed" />
        <SnapshotCard value={loading ? '—' : data.snapshot.wineriesRepresented.toString()} label="Wineries" />
      </section>
      <SectionHeading title="Recently Added" action={recent.length ? 'See all' : undefined} onAction={() => go('cellar')} />
      {recent.length ? <div className="wine-card-grid home-wine-grid">{recent.map((wine) => <WineCard key={wine.id} wine={wine} photoUrl={heroUrlFor('wine', wine.id, data, photoUrls)} onClick={() => onManage({ kind: 'wine', record: wine })} />)}</div> : <EmptyFeature icon="bottle" title="Your first bottles will appear here" body="Use Add in the bottom navigation to start the collection." />}
      {recentOpenings.length > 0 && <><SectionHeading title="Recent Memories" action="History" onAction={() => onManage({ kind: 'history' })} /><div className="compact-list">{recentOpenings.map((opening) => { const wine = data.wines.find((item) => item.id === opening.wineId); return <button className="memory-row" key={opening.id} onClick={() => onManage({ kind: 'opening', record: opening })}><span><strong>{wine?.name ?? 'Bottle opening'}</strong><small>{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(opening.openedAt))}{opening.openedBy ? ` · ${opening.openedBy}` : ''}</small></span><Icon name="chevron" size={18}/></button> })}</div></>}
    </div>
  )
}

function SnapshotCard({ value, label }: { value: string; label: string }) {
  return <article className="snapshot-card"><strong>{value}</strong><span>{label}</span></article>
}

function SectionHeading({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <div className="section-heading"><h2>{title}</h2>{action && <button onClick={onAction}>{action}</button>}</div>
}

function EmptyFeature({ icon, title, body, action, onAction }: { icon: IconName; title: string; body: string; action?: string; onAction?: () => void }) {
  return (
    <article className="empty-feature"><div className="empty-icon"><Icon name={icon}/></div><div><h3>{title}</h3><p>{body}</p>{action && <button onClick={onAction}>{action}</button>}</div></article>
  )
}

function CellarView({ data, loading, photoUrls, onManage }: { data: CellarData; loading: boolean; photoUrls: Record<string, string>; onManage: (target: ManagementTarget) => void }) {
  const [mode, setMode] = useState<'cards' | 'list'>('cards')
  const [availability, setAvailability] = useState<'available' | 'consumed' | 'all'>('available')
  const [search, setSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [wineryFilter, setWineryFilter] = useState('')
  const [styleFilter, setStyleFilter] = useState('')
  const [storageFilter, setStorageFilter] = useState('')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [buyAgainOnly, setBuyAgainOnly] = useState(false)
  const wines = data.wines.filter((wine) => {
    if (availability === 'available' && wine.availableQuantity <= 0) return false
    if (availability === 'consumed' && wine.availableQuantity > 0) return false
    if (wineryFilter && wine.wineryId !== wineryFilter) return false
    if (styleFilter && wine.style !== styleFilter && wine.category !== styleFilter) return false
    if (storageFilter && !wine.storageNames.includes(storageFilter)) return false
    if (favoriteOnly && !wine.favorite && !data.preferences.some(p => p.wineId === wine.id && p.favorite)) return false
    if (buyAgainOnly && !wine.buyAgain.includes('yes')) return false
    const haystack = [wine.name,wine.wineryName,wine.vintage,wine.style,wine.category,wine.blendDescription,wine.sweetness,wine.country,wine.state,wine.region,wine.appellation,wine.vineyard,wine.closure,...wine.storageNames,...wine.selectorNames].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(search.trim().toLowerCase())
  })
  const filterCount = [wineryFilter,styleFilter,storageFilter,favoriteOnly,buyAgainOnly].filter(Boolean).length
  return (
    <div className="screen">
      <div className="screen-lead"><div><p className="eyebrow burgundy">INVENTORY</p><h2>{loading ? 'Loading…' : `${data.snapshot.currentBottles} bottles`}</h2></div></div>
      <label className="search-box"><Icon name="search" size={20}/><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search wine, winery, vintage, varietal..." aria-label="Search the cellar" /></label>
      <button className="filter-button" onClick={() => setFiltersOpen(value => !value)}>Filters {filterCount > 0 && <span className="filter-count">{filterCount}</span>}<Icon name="chevron" size={17}/></button>
      {filtersOpen && <section className="filter-panel"><label>Winery<select value={wineryFilter} onChange={e=>setWineryFilter(e.target.value)}><option value="">All wineries</option>{data.wineries.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label><label>Style / category<select value={styleFilter} onChange={e=>setStyleFilter(e.target.value)}><option value="">All styles</option>{[...new Set(data.wines.flatMap(w=>[w.style,w.category]).filter(Boolean) as string[])].sort().map(v=><option key={v}>{v}</option>)}</select></label><label>Storage<select value={storageFilter} onChange={e=>setStorageFilter(e.target.value)}><option value="">All locations</option>{data.locations.map(l=><option key={l.id} value={l.name}>{l.name}</option>)}</select></label><label className="check-field"><input type="checkbox" checked={favoriteOnly} onChange={e=>setFavoriteOnly(e.target.checked)}/> Favorites only</label><label className="check-field"><input type="checkbox" checked={buyAgainOnly} onChange={e=>setBuyAgainOnly(e.target.checked)}/> Buy Again: Yes</label><button onClick={()=>{setWineryFilter('');setStyleFilter('');setStorageFilter('');setFavoriteOnly(false);setBuyAgainOnly(false)}}>Clear filters</button></section>}
      <div className="view-toolbar">
        <div className="segmented" aria-label="Availability"><button className={availability === 'available' ? 'active' : ''} onClick={() => setAvailability('available')}>Available</button><button className={availability === 'consumed' ? 'active' : ''} onClick={() => setAvailability('consumed')}>Consumed</button><button className={availability === 'all' ? 'active' : ''} onClick={() => setAvailability('all')}>All</button></div>
        <div className="mode-switch"><button className={mode === 'cards' ? 'active' : ''} onClick={() => setMode('cards')} aria-label="Card view"><Icon name="cellar" size={18}/></button><button className={mode === 'list' ? 'active' : ''} onClick={() => setMode('list')} aria-label="List view"><Icon name="more" size={18}/></button></div>
      </div>
      {wines.length ? <div className={mode === 'cards' ? 'wine-card-grid cellar-results' : 'wine-list cellar-results'}>{wines.map((wine) => mode === 'cards' ? <WineCard key={wine.id} wine={wine} photoUrl={heroUrlFor('wine', wine.id, data, photoUrls)} onClick={() => onManage({ kind: 'wine', record: wine })} /> : <WineRow key={wine.id} wine={wine} onClick={() => onManage({ kind: 'wine', record: wine })} />)}</div> : <div className={`inventory-empty ${mode}`}><div className="bottle-silhouette"><Icon name="bottle" size={46}/></div><h3>{search ? 'No matching wines' : 'No wines to show yet'}</h3><p>{search ? 'Try a broader search or change the availability filter.' : 'Use Add in the bottom navigation to start the collection.'}</p></div>}
    </div>
  )
}

function WineriesView({ data, loading, photoUrls, onManage }: { data: CellarData; loading: boolean; photoUrls: Record<string, string>; onManage: (target: ManagementTarget) => void }) {
  const [search, setSearch] = useState('')
  const wineries = data.wineries
  const filtered = wineries.filter((winery) => [winery.name, winery.region, winery.state, winery.country].filter(Boolean).join(' ').toLowerCase().includes(search.trim().toLowerCase()))
  return (
    <div className="screen">
      <div className="screen-lead"><div><p className="eyebrow burgundy">PLACES &amp; MEMORIES</p><h2>{loading ? 'Loading…' : `${wineries.length} wineries`}</h2></div></div>
      <label className="search-box"><Icon name="search" size={20}/><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search wineries or locations..." aria-label="Search wineries" /></label>
      {filtered.length ? <div className="winery-grid">{filtered.map((winery) => <WineryCard key={winery.id} winery={winery} photoUrl={heroUrlFor('winery', winery.id, data, photoUrls)} onOpen={() => onManage({ kind: 'winery', record: winery })} />)}</div> : <article className="winery-empty brass-corners"><div className="winery-mark"><Icon name="winery" size={40}/></div><p className="eyebrow">WINERY JOURNAL</p><h3>{search ? 'No matching wineries' : 'Save the places behind the bottles'}</h3><p>{search ? 'Try a broader place or winery name.' : 'Use Add in the bottom navigation to save a winery or visit.'}</p></article>}
    </div>
  )
}

function wineVintage(wine: WineRecord) {
  return wine.nonVintage ? 'NV' : wine.vintage?.toString() ?? 'Vintage not set'
}

function heroUrlFor(kind: 'wine' | 'winery', id: string, data: CellarData, photoUrls: Record<string, string>) {
  const photos = data.photos.filter((photo) => kind === 'wine' ? photo.wineId === id : photo.wineryId === id)
  const hero = photos.find((photo) => photo.isHero) ?? photos[0]
  return hero ? photoUrls[hero.id] : undefined
}

function WineCard({ wine, photoUrl, onClick }: { wine: WineRecord; photoUrl?: string; onClick: () => void }) {
  return (
    <button className="wine-card brass-corners" onClick={onClick} aria-label={`Open ${wine.name}`}>
      <div className="wine-visual">{photoUrl ? <img src={photoUrl} alt="" /> : <><Icon name="bottle" size={47}/><span>{wine.category || wine.style || 'WINE'}</span></>}</div>
      <div className="wine-card-copy"><p className="eyebrow burgundy">{wine.wineryName || 'INDEPENDENT WINE'}</p><h3>{wine.name}</h3><p>{wineVintage(wine)}</p><strong>{wine.availableQuantity} available{wine.storageNames.length ? ` · ${wine.storageNames.join(', ')}` : ''}</strong></div>
    </button>
  )
}

function WineRow({ wine, onClick }: { wine: WineRecord; onClick: () => void }) {
  return <button className="wine-row" onClick={onClick}><span className="row-icon"><Icon name="bottle"/></span><div><strong>{wine.name}</strong><small>{wine.wineryName || 'Winery not set'} · {wineVintage(wine)}</small></div><span className="quantity-pill">{wine.availableQuantity}</span></button>
}

function wineryPlace(winery: WineryRecord) {
  return [winery.region, winery.state, winery.country].filter(Boolean).join(', ') || 'Location not set'
}

function WineryRow({ winery }: { winery: WineryRecord }) {
  return <article className="winery-row"><span className="row-icon"><Icon name="winery"/></span><div><strong>{winery.name}</strong><small>{wineryPlace(winery)}</small></div><span className="quantity-pill">{winery.visitCount} visits</span></article>
}

function WineryCard({ winery, photoUrl, onOpen }: { winery: WineryRecord; photoUrl?: string; onOpen: () => void }) {
  return <button className="winery-card brass-corners" onClick={onOpen} aria-label={`Open ${winery.name}`}><div className="winery-card-visual">{photoUrl ? <img src={photoUrl} alt="" /> : <Icon name="winery" size={38}/>}</div><div><p className="eyebrow burgundy">{winery.favorite ? 'FAVORITE WINERY' : 'WINERY'}</p><h3>{winery.name}</h3><p>{wineryPlace(winery)}</p><div className="winery-meta"><span>{winery.wineCount} {winery.wineCount === 1 ? 'wine' : 'wines'}</span><span>{winery.visitCount} {winery.visitCount === 1 ? 'visit' : 'visits'}</span></div></div><span className="card-chevron"><Icon name="chevron" size={18}/></span></button>
}

const MORE_LINKS: Array<{ icon: IconName; label: string; detail: string }> = [
  { icon: 'history', label: 'History', detail: 'Purchases, moves and openings' },
  { icon: 'heart', label: 'Favorites', detail: 'Household member preferences' },
  { icon: 'statistics', label: 'Statistics', detail: 'Useful collection insights' },
  { icon: 'storage', label: 'Storage', detail: 'Bottle locations and movements' },
  { icon: 'document', label: 'Documents & Receipts', detail: 'Purchase paperwork and scans' },
  { icon: 'settings', label: 'Settings', detail: 'Collection and app preferences' },
]
const MORE_TARGETS: Record<string, ManagementTarget['kind']> = { History:'history', Favorites:'favorites', Statistics:'statistics', Storage:'storage', 'Documents & Receipts':'documents', Settings:'settings' }

function MoreView({ household, onSignOut, onManage }: { household: HouseholdContext; onSignOut: () => void; onManage: (target: ManagementTarget) => void }) {
  return (
    <div className="screen more-screen">
      <section className="account-card brass-corners"><BrandMark/><div><p className="eyebrow">CONNECTED COLLECTION</p><h2>{household.displayName}</h2><p>{household.role === 'owner' ? 'Owner' : household.role === 'editor' ? 'Full access' : 'View only'}</p></div></section>
      <div className="more-list">{MORE_LINKS.map((item) => <button key={item.label} onClick={() => onManage({ kind: MORE_TARGETS[item.label] } as ManagementTarget)}><span className="more-icon"><Icon name={item.icon}/></span><span><strong>{item.label}</strong><small>{item.detail}</small></span><Icon name="chevron" size={18}/></button>)}</div>
      <button className="sign-out-button" onClick={onSignOut}>Sign out</button>
      <p className="version-label">The Cellar v1.0.0</p>
    </div>
  )
}

function BottomNav({ view, go, onQuick }: { view: NavView; go: (view: NavView) => void; onQuick: () => void }) {
  const items: Array<{ id: NavView; label: string; icon: IconName }> = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'cellar', label: 'Cellar', icon: 'cellar' },
    { id: 'wineries', label: 'Wineries', icon: 'winery' },
    { id: 'more', label: 'More', icon: 'more' },
  ]
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      {items.slice(0, 2).map((item) => <NavButton key={item.id} item={item} active={view === item.id} onClick={() => go(item.id)} />)}
      <button className="quick-button" onClick={onQuick} aria-label="Add something"><span><Icon name="plus" size={29}/></span><small>Add</small></button>
      {items.slice(2).map((item) => <NavButton key={item.id} item={item} active={view === item.id} onClick={() => go(item.id)} />)}
    </nav>
  )
}

function NavButton({ item, active, onClick }: { item: { label: string; icon: IconName }; active: boolean; onClick: () => void }) {
  return <button className={active ? 'active' : ''} onClick={onClick}><Icon name={item.icon}/><small>{item.label}</small></button>
}

function QuickActions({ onClose, onSelect }: { onClose: () => void; onSelect: (action: QuickAction) => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="action-sheet" role="dialog" aria-modal="true" aria-labelledby="quick-title">
        <div className="sheet-handle"/><div className="sheet-header"><div><p className="eyebrow burgundy">QUICK ACTIONS</p><h2 id="quick-title">Add something</h2></div><button className="icon-close" onClick={onClose} aria-label="Close"><Icon name="close"/></button></div>
        <div className="action-list">{QUICK_ACTIONS.map((action) => <button key={action.id} onClick={() => onSelect(action.id)}><span><Icon name={action.icon}/></span><span><strong>{action.label}</strong><small>{action.hint}</small></span><Icon name="chevron" size={18}/></button>)}</div>
      </section>
    </div>
  )
}

export default App
