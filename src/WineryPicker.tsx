import {useId,useState} from 'react'
import type {WineryRecord} from './lib/cellar-data'

export function WineryPicker({wineries,search,selected,newWinery,context,onSearch,onSelect,onLocation}:{
 wineries:WineryRecord[];search:string;selected:boolean;newWinery:{name:string;city:string}|null;context:'wine'|'visit';
 onSearch:(value:string)=>void;onSelect:(id:string,name:string,pending?:boolean)=>void;onLocation:(city:string)=>void
}){
 const [choosing,setChoosing]=useState(!selected)
 const id=useId(),query=search.trim().toLowerCase(),show=choosing&&Boolean(query)
 const matches=query?wineries.filter(w=>w.name.toLowerCase().includes(query)).sort((a,b)=>Number(b.name.toLowerCase().startsWith(query))-Number(a.name.toLowerCase().startsWith(query))||a.name.localeCompare(b.name)).slice(0,3):[]
 const select=(wineryId:string,name:string,pending=false)=>{setChoosing(false);onSelect(wineryId,name,pending)}
 return <>
  <label>Winery<input name="winery_search" type="search" aria-expanded={show} aria-controls={show?id:undefined} autoComplete="off" value={search} placeholder="Search or add a winery" onFocus={()=>setChoosing(true)} onChange={e=>{setChoosing(true);onSearch(e.target.value)}} onKeyDown={e=>{if(show&&e.key==='Enter')e.preventDefault();if(show&&e.key==='Escape'){e.stopPropagation();setChoosing(false)}}}/></label>
  {show&&<div id={id} className="entry-suggestions winery-suggestions" role="group" aria-label="Matching wineries">{matches.map(w=><button key={w.id} type="button" onClick={()=>select(w.id,w.name)}>{w.name}{w.city?` · ${w.city}`:''}</button>)}{!wineries.some(w=>w.name.trim().toLowerCase()===query)&&<button type="button" onClick={()=>select('',search.trim(),true)}>+ Add “{search.trim()}”</button>}</div>}
  {newWinery&&<><p className="entry-context">✓ {newWinery.name} will be added with this {context}.</p><label>Winery location (optional)<input name="winery_city" placeholder="City or region" value={newWinery.city} onChange={e=>onLocation(e.target.value)}/></label></>}
 </>
}
