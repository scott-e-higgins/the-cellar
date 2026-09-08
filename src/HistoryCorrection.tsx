import {useRef,useState,type FormEvent} from 'react'
import type {CellarData,GiftRecord,PurchaseRecord} from './lib/cellar-data'
import {supabase} from './lib/supabase'
import {finishSuccessfulAction,type NoticeTone} from './lib/interaction'
import {displayDate,purchaseMatch} from './lib/presentation'
import {userError} from './lib/user-error'
export function HistoryCorrection({kind,record,data,householdId,onCancel,onSaved,onNotice}:{kind:'purchase'|'gift';record:PurchaseRecord|GiftRecord;data:CellarData;householdId:string;onCancel:()=>void;onSaved:()=>Promise<void>;onNotice:(message:string,tone?:NoticeTone)=>void}) {
 const purchase=kind==='purchase'?record as PurchaseRecord:null,gift=kind==='gift'?record as GiftRecord:null
 const [date,setDate]=useState(purchase?.acquisitionDate??gift?.giftedOn??'')
 const [visitId,setVisitId]=useState(purchase?.wineryVisitId??'')
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');const saving=useRef(false),completed=useRef(false)
 const visit=data.visits.find(v=>v.id===visitId)
 const warning=purchase&&visit?purchaseMatch(data,visit,{...purchase,acquisitionDate:date||null}).warning:null
 const submit=async(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(!supabase||saving.current||completed.current)return
  const element=event.currentTarget,form=new FormData(element);saving.current=true;setBusy(true);setMessage('')
  try {
   const optional=(key:string)=>String(form.get(key)??'').trim()||null
   const fields=purchase?{acquisition_date:date||null,winery_visit_id:visitId||null,...(purchase.acquisitionType==='gift'?{gift_from:optional('gift_from')}:{purchase_location:optional('purchase_location')}),notes:optional('notes'),...(purchase.acquisitionType!=='gift'?{total_cost:optional('total_cost')}:{} )}:{gifted_on:date,gifted_to:optional('gifted_to'),occasion_note:optional('occasion_note')}
   const result=await supabase.rpc('correct_history_record',{p_household_id:householdId,p_kind:kind,p_record_id:record.id,p_fields:fields,p_confirm_relationship:form.get('confirm_relationship')==='on'})
   if(result.error)throw result.error;completed.current=true
   await finishSuccessfulAction({form:element,refresh:onSaved,finish:onCancel,notice:onNotice,message:purchase?'Purchase corrected.':'Gift corrected.'})
  }catch(error){setMessage(userError(error,'The correction could not be saved. Please try again.'))}finally{saving.current=false;setBusy(false)}
 }
 return <form className="workflow-form detail-form edit-record-form" aria-busy={busy} onSubmit={submit}><fieldset className="workflow-fields" disabled={busy||completed.current}><h3>{purchase?'Correct purchase':'Correct gift'}</h3><p>Correct the details of this saved record. Bottle quantities and inventory history stay intact.</p><label>{gift?'Gift date':'Acquisition date'}<input name="date" type="date" required={!!gift} value={date} onChange={e=>setDate(e.target.value)}/></label>{purchase?<>{purchase.acquisitionType==='gift'?<label>Gift from<input name="gift_from" defaultValue={purchase.giftFrom??''}/></label>:<><label>Purchased at<input name="purchase_location" defaultValue={purchase.purchaseLocation??''}/></label><label>Total paid<input name="total_cost" type="number" min="0" step="0.01" defaultValue={purchase.totalCost??''}/></label></>}<label>Winery Visit<select name="winery_visit_id" value={visitId} onChange={e=>setVisitId(e.target.value)}><option value="">No linked visit — unlink</option>{data.visits.map(v=><option key={v.id} value={v.id}>{data.wineries.find(w=>w.id===v.wineryId)?.name??'Winery'} · {displayDate(v.visitDate)}</option>)}</select></label><small>Changing the visit uses its linked trip when present. Unlinking keeps the purchase and its existing trip.</small>{warning&&<label className="correction-warning" key={`${visitId}:${date}`}><input type="checkbox" name="confirm_relationship" required/> {warning} Confirm association.</label>}<label>Purchase notes<textarea name="notes" defaultValue={purchase.notes??''}/></label></>:<><label>Gifted to<input name="gifted_to" required defaultValue={gift!.giftedTo}/></label><label>Occasion / Note<textarea name="occasion_note" defaultValue={gift!.occasionNote??''}/></label></>}</fieldset>{message&&<p className="form-message error" role="alert">{message}</p>}<div className="form-actions"><button type="button" className="secondary-button" data-discard disabled={busy} onClick={onCancel}>Cancel</button><button className="primary-button" disabled={busy||completed.current}>{busy?'Saving…':'Save correction'}</button></div></form>
}
