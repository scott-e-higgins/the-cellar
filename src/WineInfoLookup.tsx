import {useCallback,useEffect,useRef,useState} from 'react'
import {supabase} from './lib/supabase'

export type WineInfoMatch={conflict_data?:{conflicts?:string[]};sources?:{source_name:string;source_url:string}[];id:string;status:string;confidence:string;match_type:string;match_explanation:string;proposed_data:Record<string,unknown>}
export type WineInfoCache=Map<string,Promise<WineInfoMatch>>
export const WINE_LOOKUP_DELAY=1000

// The parent keys this component by identity. A late response can only update
// its original, mounted identity; the cache also coalesces identical wine lines.
export function WineInfoLookup({householdId,wineryName,name,vintage,nonVintage,cache,cacheKey,disabled,accepted,onUse}: {
 householdId:string;wineryName:string;name:string;vintage:string;nonVintage:boolean;cache:WineInfoCache;cacheKey:string;disabled:boolean;accepted:boolean;onUse:(match:WineInfoMatch)=>void
}){
 const [match,setMatch]=useState<WineInfoMatch>(),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false)
 const mounted=useRef(false),inFlight=useRef(false)
 const ready=Boolean(wineryName.trim()&&name.trim())
 const autoReady=ready&&(nonVintage||(/^\d{4}$/.test(vintage)&&Number(vintage)>=1800&&Number(vintage)<=2200))
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 const lookup=useCallback(async()=>{
  if(!supabase||inFlight.current)return
  inFlight.current=true;setLoading(true);setFailed(false)
  let request=cache.get(cacheKey)
  if(!request){
   request=(async()=>{
    const response=await supabase!.functions.invoke('enrich-record',{body:{action:'preview_wine',householdId,draft:{name:name.trim(),winery_name:wineryName.trim(),vintage:nonVintage||!vintage?null:Number(vintage),non_vintage:nonVintage}}})
    if(response.error||!response.data?.attempt)throw response.error??new Error('No wine information returned')
    return {...response.data.attempt,sources:response.data.sources} as WineInfoMatch
   })()
   cache.set(cacheKey,request)
  }
  try{const result=await request;if(mounted.current)setMatch(result)}
  catch{if(mounted.current)setFailed(true)}
  finally{inFlight.current=false;if(mounted.current)setLoading(false)}
 },[cache,cacheKey,householdId,name,wineryName,vintage,nonVintage])
 useEffect(()=>{
  if(!autoReady||disabled)return
  const timer=setTimeout(()=>void lookup(),WINE_LOOKUP_DELAY)
  return()=>clearTimeout(timer)
 },[autoReady,disabled,lookup])
 const usable=match?.status==='ready_for_review'&&match.match_type!=='none'&&match.confidence!=='none'&&Object.keys(match.proposed_data??{}).length>0
 const conflicts=match?.conflict_data?.conflicts??[]
 const strong=conflicts.length===0&&usable&&match.match_type==='exact'&&match.confidence==='high'
 return <div className="wine-info-lookup">
  <button type="button" className="secondary-button full-button" disabled={disabled||loading||!ready} onClick={()=>{if(failed||match?.status==='no_match')cache.delete(cacheKey);void lookup()}}>{loading?'Finding wine information…':'Find Wine Info'}</button>
  <div aria-live="polite">
   {loading&&<small>You can keep entering bottles or save now.</small>}
   {failed&&<small>Wine info is unavailable right now. You can save or try Find Wine Info again.</small>}
   {match&&!usable&&<small>No reliable match found. You can still save this wine.</small>}
  </div>
  {match&&usable&&<div className="entry-match">
   <strong role="status">{accepted?'✓ Information selected':strong?'Wine info found ✓':'Wine info needs review'}</strong>
   <p>{match.match_explanation}</p>
   {conflicts.length>0&&<ul>{conflicts.map((conflict,index)=><li key={index}>{conflict}</li>)}</ul>}
   <dl>{['official_name','producer','vintage','category','style','grapes','region'].filter(k=>match.proposed_data[k]!=null).map(k=><div key={k}><dt>{k.replaceAll('_',' ')}</dt><dd>{String(match.proposed_data[k])}</dd></div>)}</dl>
   <details><summary>More sourced information</summary>{Object.entries(match.proposed_data).map(([k,v])=><p key={k}><strong>{k.replaceAll('_',' ')}:</strong> {Array.isArray(v)?v.join(', '):String(v)}</p>)}</details>
   {match.sources?.map(source=><a key={source.source_url} href={source.source_url} target="_blank" rel="noreferrer">{source.source_name} ↗</a>)}
   {!accepted&&<button type="button" className="primary-button" disabled={disabled} onClick={()=>onUse(match)}>Use Info</button>}
   <small>Only saved with your wine after you choose Use Info. Our personal fields stay separate.</small>
  </div>}
 </div>
}
