import { useEffect, useState, type ImgHTMLAttributes } from 'react'
export function PhotoImage(props:ImgHTMLAttributes<HTMLImageElement>) {
 const [failed,setFailed]=useState(false)
 useEffect(()=>setFailed(false),[props.src])
 useEffect(()=>{const retry=()=>setFailed(false);window.addEventListener('cellar-retry-photos',retry);return()=>window.removeEventListener('cellar-retry-photos',retry)},[])
 return failed?<span className="photo-unavailable">Photo unavailable</span>:<img {...props} onError={event=>{setFailed(true);window.dispatchEvent(new CustomEvent('cellar-photo-error',{detail:props.src}));props.onError?.(event)}} />
}
