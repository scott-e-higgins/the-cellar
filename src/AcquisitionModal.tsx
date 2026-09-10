import {useRef,useState,type FormEvent} from 'react'
import type {CellarData} from './lib/cellar-data'
import {supabase} from './lib/supabase'
import {createUniqueId} from './lib/unique-id'
import {type NoticeTone} from './lib/interaction'
import {markFormSaved} from './lib/unsaved-changes'
import {userError,validatePhoto} from './lib/user-error'
import {createPhotoUpload} from './lib/photo-upload'
import {ModalLayer} from './OverlayLayer'
import {PhotoPicker} from './PhotoPicker'
import {inferEntryContext,type EntryContext} from './lib/entry-context'
import type {EntryCompletion,EntryResult} from './lib/entry-types'
import {acquisitionItems,blankWine,numeric,type AcquisitionLine} from './lib/acquisition-items'
import {displayDate} from './lib/presentation'
import {WineInfoLookup,type WineInfoMatch,type WineInfoCache} from './WineInfoLookup'
export {acquisitionItems} from './lib/acquisition-items'
export type {WineDraft,AcquisitionLine} from './lib/acquisition-items'
type Line=AcquisitionLine&{match?:WineInfoMatch;accepted?:boolean}
const today=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)}
export function AcquisitionModal({auditMode=false,action,householdId,data,initialWineryId,initialVisitId,initialDate,initialTripId,initialPurchaseId,initialLocationId,onClose,onSaved,onNotice,onComplete}: {
 auditMode?:boolean;action:'add-wine'|'record-purchase';householdId:string;data:CellarData;initialWineryId?:string|null;initialVisitId?:string|null;initialDate?:string|null;initialTripId?:string|null;initialPurchaseId?:string|null;initialLocationId?:string|null;
 onClose:()=>void;onSaved:()=>Promise<void>;onNotice:(message:string,tone?:NoticeTone)=>void;onComplete?:(completion:EntryCompletion)=>void
}){
 const existingPurchase=data.purchases.find(p=>p.id===initialPurchaseId)
 const [winery,setWinery]=useState(initialWineryId??'')
 const [winerySearch,setWinerySearch]=useState(data.wineries.find(w=>w.id===initialWineryId)?.name??'')
 const [newWinery,setNewWinery]=useState<{name:string;city:string}|null>(null)
 const [choosingWinery,setChoosingWinery]=useState(!initialWineryId)
 const [date,setDate]=useState(existingPurchase?(existingPurchase.acquisitionDate??''):(initialDate??today()))
 const [visitChoice,setVisitChoice]=useState<string|undefined>(initialVisitId??undefined)
 const [tripChoice,setTripChoice]=useState<string|undefined>(initialTripId??undefined)
 const [createVisit,setCreateVisit]=useState(false)
 const [purchasePlace,setPurchasePlace]=useState<string|undefined>(existingPurchase?.purchaseLocation??undefined)
 const [kind,setKind]=useState(existingPurchase?.acquisitionType??'purchased')
 const [definitionOnly,setDefinitionOnly]=useState(auditMode)
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[uncertain,setUncertain]=useState(false)
 const selectedWinery=data.wineries.find(w=>w.id===winery)
 const wineryName=selectedWinery?.name??newWinery?.name??winerySearch
 const wineryQuery=winerySearch.trim().toLowerCase()
 const matchingWineries=wineryQuery?data.wineries.filter(w=>w.name.toLowerCase().includes(wineryQuery)).sort((a,b)=>Number(b.name.toLowerCase().startsWith(wineryQuery))-Number(a.name.toLowerCase().startsWith(wineryQuery))||a.name.localeCompare(b.name)).slice(0,3):[]
 const showWineryResults=choosingWinery&&Boolean(wineryQuery)
 const rack=initialLocationId??data.locations.find(l=>l.isActive&&l.name.toLowerCase()==='rack')?.id??data.locations.find(l=>l.isActive)?.id??''
 const makeLine=():Line=>({id:createUniqueId(),wineId:'',draft:blankWine(winery),quantity:'1',location:rack,price:'',currentValue:''})
 const [lines,setLines]=useState<Line[]>(()=>[makeLine()])
 const update=(id:string,patch:Partial<Line>)=>setLines(items=>items.map(l=>l.id===id?{...l,...patch}:l))
 const attachment=useRef<File|null>(null)
 const requestId=useRef(createUniqueId()),payload=useRef<Record<string,unknown>|null>(null),flight=useRef(false),saved=useRef(false)
 const context=inferEntryContext(data,winery,date,visitChoice,tripChoice)
 const lookupCache=useRef<WineInfoCache>(new Map())
 const selectWinery=(id:string,name:string,pending=false)=>{setWinery(id);setWinerySearch(name);setNewWinery(pending?{name,city:''}:null);setChoosingWinery(false);setVisitChoice(undefined);setTripChoice(undefined);setCreateVisit(false);setLines(items=>items.map(l=>({...l,wineId:'',draft:{...l.draft!,winery_id:id},match:undefined,accepted:false}))) }
 const submit=async(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(!supabase||flight.current||saved.current)return
  const form=event.currentTarget,fd=new FormData(form)
  flight.current=true;setBusy(true);setMessage('')
  let photo=(form.elements.namedItem('photo') as HTMLInputElement|null)?.files?.[0]??null
  try{
   if(uncertain)photo=attachment.current
   else attachment.current=photo
   if(photo)validatePhoto(photo)
   if(!payload.current||!uncertain){
    if(!winery&&!newWinery)throw new Error('Choose a winery or add it here.')
    if(!definitionOnly&&!initialPurchaseId&&(context.ambiguousTrip||context.ambiguousVisit))throw new Error('Choose the matching Trip or Visit, or leave it unlinked.')
    const items=definitionOnly?lines.map(l=>({wine_id:l.wineId||null,new_wine:l.draft})):acquisitionItems(lines,kind==='gift')
    const sums=lines.map(l=>numeric(l.price)===null?null:Number(l.quantity)*Number(l.price)),subtotal=kind==='gift'||sums.some(v=>v===null)?null:sums.reduce<number>((n,v)=>n+(v??0),0)
    const tax=numeric(String(fd.get('tax')??'')),discount=numeric(String(fd.get('discount')??''))
    payload.current={p_household_id:householdId,p_request_id:requestId.current,p_definition_only:definitionOnly,p_lines:items.map((l,i)=>({...l,enrichment_attempt_id:lines[i].accepted?lines[i].match?.id:null})),p_details:{winery_id:winery||null,new_winery:newWinery,purchase_id:initialPurchaseId??null,acquisition_type:kind,acquisition_date:date||null,visit_id:context.visitId||null,trip_id:context.tripId||null,visit_mode:!definitionOnly&&visitChoice===undefined?'auto':'manual',trip_mode:!definitionOnly&&tripChoice===undefined?'auto':'manual',create_visit:!definitionOnly&&createVisit,purchase_location:kind==='gift'?null:String(fd.get('purchase_location')??wineryName),gift_from:kind==='gift'?String(fd.get('gift_from')??''):null,subtotal,tax,discount,total_cost:kind==='gift'?null:numeric(String(fd.get('total_cost')??''))??(subtotal===null?null:subtotal+(tax??0)-(discount??0)),notes:String(fd.get('notes')??''),purchased_by_person_id:fd.get('purchased_by_person_id')||null,selected_by_person_id:fd.get('selected_by_person_id')||null}}
   }
   const response=await supabase.rpc('save_wine_entry',payload.current!)
   if(response.error){setUncertain(!response.error.code||/fetch|network|timeout|connection/i.test(response.error.message));throw response.error}
   saved.current=true;markFormSaved(form)
   const result=response.data as EntryResult
   let retryPhoto:(()=>Promise<void>)|undefined
   if(photo){const upload=createPhotoUpload(supabase,photo,householdId,'wines',{wine_id:result.wine_ids[0]});try{await upload()}catch{retryPhoto=upload}}
   let refreshFailed=false
   try{await onSaved()}catch{refreshFailed=true}
   markFormSaved(form)
   const next:EntryContext={wineryId:result.winery_id,visitId:result.visit_id,tripId:result.trip_id,date,purchaseId:result.purchase_id,locationId:lines[0].location,purchaseLocation:wineryName}
   // Completion is explicit; it does not depend on Back passing a busy-form guard.
   if(onComplete)onComplete({result,context:next,retryPhoto,refreshFailed})
   else {setBusy(false);queueMicrotask(onClose)}
   onNotice(refreshFailed?`Saved, but the screen could not refresh.${retryPhoto?' Record saved; photo not added.':''}`:retryPhoto?'Record saved; photo not added.':definitionOnly?'Wine saved without bottles.':'Wine and bottles added to our Cellar.',refreshFailed||retryPhoto?'warning':'success')
  }catch(error){setMessage(userError(error,'The save could not be confirmed. Retry Save safely retries the same acquisition.'))}finally{flight.current=false;setBusy(false)}
 }
 return <ModalLayer layer="action" dismissible={!busy} onDismiss={onClose} surfaceClassName="workflow-modal workflow-form-modal wine-entry-modal" ariaLabelledBy="entry-title">
  <div className="sheet-header entry-header"><div><p className="eyebrow burgundy">OUR CELLAR</p><h2 id="entry-title">{initialPurchaseId?'Add Another Wine':action==='record-purchase'?'Add Wines & Bottles':'Add Wine'}</h2></div><button className="icon-close" aria-label="Close" disabled={busy} onClick={onClose}>×</button></div>
  <form className="workflow-form wine-entry-form" aria-busy={busy} onSubmit={submit}>
   <fieldset className="workflow-fields" disabled={busy||uncertain||saved.current}>
    {auditMode&&<p className="entry-context">Add the wine’s identity here. Return to the audit to count its bottles; inventory changes only when you Apply Audit.</p>}
    <section className="entry-section">
     <label>Winery<input name="winery_search" type="search" aria-expanded={showWineryResults} aria-controls={showWineryResults?'entry-winery-results':undefined} onKeyDown={e=>{if(showWineryResults&&e.key==='Enter')e.preventDefault();if(showWineryResults&&e.key==='Escape'){e.stopPropagation();setChoosingWinery(false)}}} autoComplete="off" value={winerySearch} onFocus={()=>setChoosingWinery(true)} onChange={e=>{setWinerySearch(e.target.value);setChoosingWinery(true);setWinery('');setNewWinery(null);setVisitChoice(undefined);setTripChoice(undefined);setLines(ls=>ls.map(l=>({...l,match:undefined,accepted:false,wineId:''})))}} placeholder="Search or add a winery"/></label>
     {showWineryResults&&<div id="entry-winery-results" className="entry-suggestions winery-suggestions" role="group" aria-label="Matching wineries">{matchingWineries.map(w=><button key={w.id} type="button" onClick={()=>selectWinery(w.id,w.name)}>{w.name}{w.city?` · ${w.city}`:''}</button>)}{winerySearch.trim()&&!data.wineries.some(w=>w.name.toLowerCase()===winerySearch.trim().toLowerCase())&&<button type="button" onClick={()=>selectWinery('',winerySearch.trim(),true)}>+ Add “{winerySearch.trim()}”</button>}</div>}
     {newWinery&&<><p className="entry-context">✓ {newWinery.name} will be added with this wine.</p><label>Winery location (optional)<input name="winery_city" placeholder="City or region" value={newWinery.city} onChange={e=>setNewWinery({...newWinery,city:e.target.value})}/></label></>}
    </section>
    {lines.map((item,index)=>{const draft=item.draft!,existing=data.wines.filter(w=>w.wineryId===winery&&draft.name.trim()&&w.name.toLowerCase().includes(draft.name.trim().toLowerCase())).slice(0,5);return <section className="entry-section" key={item.id}>
     {lines.length>1&&<div className="sheet-header"><h3>Wine {index+1}</h3><button type="button" className="text-button" onClick={()=>{if(!draft.name.trim()||window.confirm("Remove this wine from the entry?"))setLines(ls=>ls.filter(l=>l.id!==item.id))}}>Remove wine</button></div>}
     <label>Wine name<input name={`wine_${item.id}`} autoComplete="off" required value={draft.name} onChange={e=>update(item.id,{wineId:'',draft:{...draft,name:e.target.value},match:undefined,accepted:false})}/></label>
     {!item.wineId&&existing.length>0&&<div className="entry-suggestions" role="group" aria-label="Existing wines">{existing.map(w=><button type="button" key={w.id} onClick={()=>update(item.id,{wineId:w.id,draft:{...blankWine(winery),name:w.name,vintage:w.vintage?.toString()??'',non_vintage:String(w.nonVintage)},match:undefined,accepted:false})}>Use {w.name} · {w.nonVintage?'NV':w.vintage??'Vintage unknown'}</button>)}</div>}
     <div className="field-grid"><label>Vintage<input name={`vintage_${item.id}`} type="number" inputMode="numeric" min="1800" max="2200" disabled={draft.non_vintage==='true'} value={draft.vintage} onChange={e=>update(item.id,{wineId:'',draft:{...draft,vintage:e.target.value},match:undefined,accepted:false})}/></label><label className="check-field"><input name={`nv_${item.id}`} type="checkbox" checked={draft.non_vintage==='true'} onChange={e=>update(item.id,{wineId:'',draft:{...draft,non_vintage:String(e.target.checked)},match:undefined,accepted:false})}/> Non-vintage</label></div>
     {item.wineId&&<p className="entry-context">✓ Adding bottles to this existing wine.</p>}
     {(()=>{const identity=JSON.stringify([householdId,winery||newWinery?.name||'',wineryName.trim(),draft.name.trim(),draft.non_vintage==='true'?'NV':draft.vintage]);return <WineInfoLookup key={identity} cacheKey={identity} cache={lookupCache.current} householdId={householdId} wineryName={winery||newWinery?wineryName:''} name={draft.name} vintage={draft.vintage} nonVintage={draft.non_vintage==='true'} disabled={busy||uncertain||saved.current} accepted={Boolean(item.accepted)} onUse={match=>update(item.id,{match,accepted:true})}/>})()}
     {!definitionOnly&&<div className="field-grid"><label>Quantity<input name={`quantity_${item.id}`} type="number" inputMode="numeric" min="1" step="1" required value={item.quantity} onChange={e=>update(item.id,{quantity:e.target.value})}/></label><label>Price per bottle (optional)<input name={`price_${item.id}`} type="number" inputMode="decimal" min="0" step="0.01" disabled={kind==='gift'} value={item.price} onChange={e=>update(item.id,{price:e.target.value})}/></label></div>}
     {!item.wineId&&<details><summary>Our notes</summary><label>Our notes<textarea name={`personal_${item.id}`} value={draft.personal_notes??''} onChange={e=>update(item.id,{draft:{...draft,personal_notes:e.target.value}})}/></label></details>}
    </section>})}
    {!definitionOnly&&<section className="entry-section">
     {initialPurchaseId?<p className="entry-context">Adding to the same purchase{date?` · ${displayDate(date)}`:''}. Its Visit and Trip stay linked.</p>:<><div className="field-grid"><label>Acquisition<select name="kind" value={kind} onChange={e=>setKind(e.target.value as 'purchased'|'gift')}><option value="purchased">Purchased</option><option value="gift">Received as a gift</option></select></label><label>Purchase date<input name="date" type="date" required={kind==='purchased'} value={date} onChange={e=>{setDate(e.target.value);setVisitChoice(undefined);setTripChoice(undefined);setCreateVisit(false)}}/></label></div>
     <div className="entry-context"><p>Trip: {data.trips.find(t=>t.id===context.tripId)?.name??(context.ambiguousTrip?'Choose a matching trip':'Not linked')}{context.tripId?' ✓':''}</p><p>Visit: {context.visitId?`${wineryName} · ${displayDate(data.visits.find(v=>v.id===context.visitId)?.visitDate??date)} ✓`:context.ambiguousVisit?'Choose a matching visit':'No matching visit'}</p></div>
     {(context.ambiguousTrip||context.ambiguousVisit)&&<p role="alert">More than one match. Choose below or leave it unlinked.</p>}
     <details open={context.ambiguousTrip||context.ambiguousVisit||undefined}><summary>Change Trip / Visit</summary><label>Visit<select name="visit" value={visitChoice??(context.ambiguousVisit?'choose':context.visitId)} onChange={e=>{setVisitChoice(e.target.value);setTripChoice(undefined);setCreateVisit(false)}}><option value="choose" disabled>Choose a visit</option><option value="">No linked visit</option>{data.visits.filter(v=>v.wineryId===winery).map(v=><option key={v.id} value={v.id}>{wineryName} · {displayDate(v.visitDate)}</option>)}</select></label><label>Trip<select name="trip" value={tripChoice??(context.ambiguousTrip?'choose':context.tripId)} onChange={e=>setTripChoice(e.target.value)}><option value="choose" disabled>Choose a trip</option><option value="">No linked trip</option>{data.trips.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>{context.conflict&&<small>This purchase’s Trip differs from the Visit’s Trip.</small>}</details>
     {!context.visitId&&!context.ambiguousVisit&&(winery||newWinery)&&date&&<label className="check-field"><input type="checkbox" name="create_visit" checked={createVisit} onChange={e=>setCreateVisit(e.target.checked)}/> Create Visit for this date</label>}
     </>}
     {lines.map((item,index)=><label key={item.id}>{lines.length>1?`Storage for wine ${index+1}`:'Storage'}<select name={`location_${item.id}`} required value={item.location} onChange={e=>update(item.id,{location:e.target.value})}><option value="">Choose storage</option>{data.locations.filter(l=>l.isActive).map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>)}
     <button type="button" className="secondary-button" onClick={()=>setLines(ls=>[...ls,{...makeLine(),location:ls[0]?.location??rack}])}>Add another wine before saving</button>
     <details><summary>More acquisition details / photo</summary>{!initialPurchaseId&&<><fieldset className="workflow-fields" hidden={kind==='gift'} disabled={kind==='gift'}><label>Purchased at<input name="purchase_location" value={purchasePlace??wineryName} onChange={e=>setPurchasePlace(e.target.value)}/></label></fieldset><fieldset className="workflow-fields" hidden={kind!=='gift'} disabled={kind!=='gift'}><label>Gift from<input name="gift_from"/></label></fieldset><div className="field-grid">{[['tax','Tax'],['discount','Discount'],['total_cost','Final total']].map(([key,label])=><label key={key}>{label}<input name={key} type="number" inputMode="decimal" min="0" step="0.01"/></label>)}</div>{[['purchased_by_person_id','Purchased by'],['selected_by_person_id','Selected by']].map(([key,label])=><label key={key}>{label}<select name={key}><option value="">Not specified</option>{data.people.map(p=><option key={p.id} value={p.id}>{p.displayName}</option>)}</select></label>)}<label>Purchase notes<textarea name="notes"/></label></>}<PhotoPicker name="photo" label="Photo of the first wine (optional)"/></details>
    </section>}
    {!auditMode&&!initialPurchaseId&&lines.length===1&&<details><summary>Wine without bottles</summary><label className="check-field"><input name="definition_only" type="checkbox" checked={definitionOnly} onChange={e=>setDefinitionOnly(e.target.checked)}/> Save wine without adding bottles</label></details>}
   </fieldset>
   {message&&<p role="alert" className="form-message error">{message}</p>}{uncertain&&<p>The connection was interrupted. Retry Save checks the same acquisition without adding bottles twice.</p>}
   <div className="form-actions entry-save"><button type="button" data-discard className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy||saved.current}>{busy?'Saving…':uncertain?'Retry Save':'Save'}</button></div>
  </form>
 </ModalLayer>
}
