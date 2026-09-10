import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react'
import type {CellarData} from './lib/cellar-data'
import {supabase} from './lib/supabase'
import {finishSuccessfulAction,type NoticeTone} from './lib/interaction'
import {displayDate} from './lib/presentation'

export type TripMatch={purchase_id:string;status:string;method?:string;trip_ids:string[];reason:string;warning?:string|null}
const categories:Record<string,string>={needs_review:'Suggested / Needs Review',auto_linked:'Auto-linked',already_linked:'Already Linked',no_match:'No Match',insufficient_information:'Insufficient Information',left_unlinked:'Left Unlinked',ready:'Obvious Matches'}
export function TripReconciliation({householdId,data,editable,onSaved,onNotice}:{householdId:string;data:CellarData;editable:boolean;onSaved:()=>Promise<void>;onNotice:(message:string,tone?:NoticeTone)=>void}){
 const [rows,setRows]=useState<TripMatch[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState<string|null>(null)
 const [filter,setFilter]=useState(()=>sessionStorage.getItem('cellar.tripReview.filter')??'needs_review'),[search,setSearch]=useState(()=>sessionStorage.getItem('cellar.tripReview.search')??'')
 const saving=useRef(false)
 useEffect(()=>{sessionStorage.setItem('cellar.tripReview.filter',filter)},[filter]);useEffect(()=>{sessionStorage.setItem('cellar.tripReview.search',search)},[search])
 const load=useCallback(async()=>{if(!supabase)return;setLoading(true);setError('');try{const result=await supabase.rpc('purchase_trip_queue',{p_household_id:householdId});if(result.error)throw result.error;setRows(result.data??[])}catch{setError('Trip links could not refresh. Retry to load the current relationships.');throw new Error('Queue refresh failed')}finally{setLoading(false)}},[householdId])
 useEffect(()=>{void load().catch(()=>{})},[load])
 const decide=async(row:TripMatch,action:'accept'|'leave_unlinked'|'auto',tripId:string|null=null,form?:HTMLFormElement)=>{
  if(!supabase||!editable||saving.current)return;saving.current=true;setBusy(true);setError('')
  try{
   const result=await supabase.rpc('reconcile_purchase_trip',{p_household_id:householdId,p_purchase_id:row.purchase_id,p_action:action,p_trip_id:tripId});if(result.error)throw result.error
   setRows(previous=>previous.map(item=>item.purchase_id===row.purchase_id?result.data:item))
   await finishSuccessfulAction({form,refresh:async()=>{await onSaved();await load()},finish:()=>setEditing(null),notice:onNotice,message:result.data.status==='left_unlinked'?'Left unlinked.':'Trip relationship saved.'})
  }catch{setError('The decision could not be confirmed. Retry safely; existing Trip links will be preserved.')}finally{saving.current=false;setBusy(false)}
 }
 const identity=(row:TripMatch)=>data.purchaseItems.filter(i=>i.purchaseId===row.purchase_id).map(i=>data.wines.find(w=>w.id===i.wineId)).filter(w=>!!w).map(w=>`${w!.wineryName??'Winery not recorded'} · ${w!.name} · ${w!.nonVintage?'NV':w!.vintage??'Vintage not recorded'}`)
 const visible=rows.filter(row=>(filter==='all'||(filter==='suspicious'?!!row.warning:row.status===filter))&&identity(row).join(' ').toLowerCase().includes(search.toLowerCase()))
 return <div className="detail-content"><p>Connect acquisition history to Travel Journal Trips. Existing links are preserved; only uncertain matches need a decision.</p>
  <div className="field-grid"><label>Show<select value={filter} onChange={e=>setFilter(e.target.value)} disabled={busy}><option value="all">All acquisitions ({rows.length})</option>{Object.entries(categories).map(([key,label])=><option key={key} value={key}>{label} ({rows.filter(r=>r.status===key).length})</option>)}<option value="suspicious">Check existing links ({rows.filter(r=>r.warning).length})</option></select></label><label>Search wines<input type="search" value={search} onChange={e=>setSearch(e.target.value)} disabled={busy}/></label></div>
  {error&&<p role="alert">{error}</p>}<button data-keep-draft className="text-button" disabled={loading||busy} onClick={()=>void load().catch(()=>{})}>{loading?'Loading Trip links…':'Retry / Refresh Trip Links'}</button>
  {!loading&&!visible.length&&<p>No acquisitions in this view.</p>}
  {visible.map(row=>{const purchase=data.purchases.find(p=>p.id===row.purchase_id);const linked=['already_linked','auto_linked'].includes(row.status);return <section className="detail-section" key={row.purchase_id}>
   <h3>{identity(row).join('; ')||'Acquisition'}</h3><p>{purchase?.acquisitionDate?displayDate(purchase.acquisitionDate):'Acquisition date not recorded'}{purchase?.purchaseLocation?` · ${purchase.purchaseLocation}`:''}</p><p><strong>{categories[row.status]??row.status}</strong> · {row.reason}</p>
   {row.trip_ids.map(id=>{const trip=data.trips.find(t=>t.id===id);return <p key={id}>{trip?`${trip.name} · ${displayDate(trip.startDate)}–${displayDate(trip.endDate)}`:'Linked Trip is unavailable'}</p>})}
   {row.warning&&<p role="alert">{row.warning}. Left unchanged.</p>}
   {editable&&!linked&&(editing===row.purchase_id?<form className="workflow-form" aria-busy={busy} onSubmit={(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const form=e.currentTarget;void decide(row,'accept',String(new FormData(form).get('trip')),form)}}><label>Travel Journal Trip<select name="trip" required defaultValue={row.trip_ids.length===1?row.trip_ids[0]:''} disabled={busy}><option value="">Choose a Trip</option>{data.trips.map(t=><option key={t.id} value={t.id}>{t.name} · {displayDate(t.startDate)}–{displayDate(t.endDate)}</option>)}</select></label><div className="form-actions"><button className="primary-button" disabled={busy}>{busy?'Saving…':'Save Trip'}</button><button type="button" data-discard className="secondary-button" disabled={busy} onClick={()=>setEditing(null)}>Cancel</button></div></form>:<div className="section-actions">{row.trip_ids.length===1&&data.trips.some(t=>t.id===row.trip_ids[0])&&<button className="primary-button" disabled={busy} onClick={()=>void decide(row,row.status==='ready'?'auto':'accept',row.trip_ids[0])}>Accept Suggested Trip</button>}<button className="secondary-button" disabled={busy} onClick={()=>setEditing(row.purchase_id)}>Choose Different Trip</button>{row.status!=='left_unlinked'&&<button className="text-button" disabled={busy} onClick={()=>void decide(row,'leave_unlinked')}>Leave Unlinked</button>}</div>)}
  </section>})}
 </div>
}
